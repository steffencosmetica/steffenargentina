'use client';

import '@/styles/carrito.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addToCart, limitMessage, quantityOf, removeFromCart, setLineQuantity, totalUnits } from '@/lib/cart/model';
import { reconcile, type Snapshot } from '@/lib/cart/reconcile';
import { CART_STORAGE_KEY, parseStoredCart, serializeCart } from '@/lib/cart/storage';
import type { CartItem, CartLimits, CartQuote } from '@/lib/cart/types';
import CartDrawer from './CartDrawer';

// Estado del carrito para las páginas públicas. Solo se monta si el servidor habilitó el carrito
// (SiteShell → isCartEnabled()); sin provider, los botones y el ícono del header no se renderizan.
//
// - Persistencia: localStorage (steffen-carrito-v1), solo producto y cantidad.
// - Precios, estado y límites: siempre de POST /api/carrito/cotizar (datos actuales del servidor).
// - API para el checkout (Fase 4B.5): items, refreshQuote() y clear(). «Finalizar compra» no vacía nada.

export type AddFeedback = { productId: string; text: string; ok: boolean; at: number };

export type CartContextValue = {
  /** false hasta leer localStorage (el HTML del servidor no conoce el carrito: evita diferencias de hidratación) */
  hydrated: boolean;
  items: CartItem[];
  units: number;
  limits: CartLimits | null;
  quote: CartQuote | null;
  quoting: boolean;
  quoteError: boolean;
  notices: string[];
  feedback: AddFeedback | null;
  isOpen: boolean;
  open: (opener?: HTMLElement | null) => void;
  close: () => void;
  add: (productId: string, productName: string, amount?: number) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  dismissNotices: () => void;
  /** cotización actual del carrito (la usará el checkout antes de confirmar) */
  refreshQuote: () => Promise<CartQuote | null>;
  /** vacía el carrito: solo cuando el pago de un pedido quede confirmado (Fase 5); crear un pedido pendiente no lo vacía */
  clear: () => void;
  /** el servidor habilitó la página de checkout en este despliegue */
  checkoutAvailable: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

/** Carrito actual, o null si el carrito no está habilitado en este despliegue. */
export function useCartOptional() {
  return useContext(CartContext);
}

const QUOTE_URL = '/api/carrito/cotizar';

async function requestQuote(items: CartItem[], signal?: AbortSignal): Promise<CartQuote> {
  const response = await fetch(QUOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`cotización ${response.status}`);
  return (await response.json()) as CartQuote;
}

function readStorage(): CartItem[] {
  try {
    return parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return []; // localStorage bloqueado (modo privado estricto, cookies deshabilitadas)
  }
}

export default function CartProvider({ children, checkoutAvailable = false }: { children: React.ReactNode; checkoutAvailable?: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<CartItem[]>([]);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const snapshot = useRef<Snapshot>(new Map());
  const sequence = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  // --- persistencia ---------------------------------------------------------------------------
  useEffect(() => {
    setItems(readStorage());
    setHydrated(true);
    // otra pestaña cambió el carrito
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_STORAGE_KEY) setItems(parseStoredCart(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (items.length) window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(items));
      else window.localStorage.removeItem(CART_STORAGE_KEY);
    } catch {
      // sin localStorage el carrito funciona igual durante la visita
    }
  }, [items, hydrated]);

  // --- cotización -----------------------------------------------------------------------------
  const pushNotices = useCallback((list: string[]) => {
    if (!list.length) return;
    setNotices((prev) => [...prev, ...list.filter((n) => !prev.includes(n))].slice(-6));
    setAnnouncement(list.join(' '));
  }, []);

  const refreshQuote = useCallback(async (): Promise<CartQuote | null> => {
    const id = ++sequence.current;
    const current = itemsRef.current;
    setQuoting(true);
    try {
      const result = await requestQuote(current);
      if (id !== sequence.current) return result; // llegó una cotización más nueva
      setQuote(result);
      setQuoteError(false);
      const r = reconcile(itemsRef.current, result, snapshot.current);
      snapshot.current = new Map([...snapshot.current, ...r.snapshot]);
      pushNotices(r.notices);
      if (r.adjusted) setItems(r.items); // vuelve a cotizar con las cantidades ajustadas
      return result;
    } catch {
      if (id === sequence.current) setQuoteError(true);
      return null;
    } finally {
      if (id === sequence.current) setQuoting(false);
    }
  }, [pushNotices]);

  // al cargar el carrito guardado y en cada cambio de cantidades (con una pequeña espera para agrupar clics)
  const itemsKey = useMemo(() => items.map((i) => `${i.productId}:${i.quantity}`).join(','), [items]);
  useEffect(() => {
    if (!hydrated || !itemsKey) {
      if (hydrated && !itemsKey) setQuote((q) => (q ? { ...q, lines: [], units: 0, subtotalCentavos: 0, exceedsOrderLimit: false, canCheckout: false } : q));
      return;
    }
    const timer = setTimeout(() => void refreshQuote(), 250);
    return () => clearTimeout(timer);
  }, [hydrated, itemsKey, refreshQuote]);

  // --- acciones -------------------------------------------------------------------------------
  const maxQuantityOf = (productId: string) => quoteRef.current?.lines.find((l) => l.productId === productId)?.maxQuantity;

  const open = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setIsOpen(true);
    if (itemsRef.current.length) void refreshQuote(); // al abrirse, precios al día
  }, [refreshQuote]);

  const close = useCallback(() => {
    setIsOpen(false);
    // el foco vuelve a quien abrió el carrito (si sigue en la página)
    const target = opener.current;
    requestAnimationFrame(() => (target?.isConnected ? target : document.querySelector<HTMLElement>('[data-testid="cart-button"]'))?.focus());
  }, []);

  const add = useCallback(
    async (productId: string, productName: string, amount = 1) => {
      // los límites los define el servidor: si todavía no se conocen, se cotiza antes de agregar
      const limits = quoteRef.current?.limits ?? (await refreshQuote())?.limits;
      if (!limits) {
        const text = 'No pudimos agregar el producto. Revisá tu conexión e intentá de nuevo.';
        setFeedback({ productId, text, ok: false, at: Date.now() });
        setAnnouncement(text);
        return;
      }
      const change = addToCart(itemsRef.current, productId, amount, limits, maxQuantityOf(productId));
      let text: string;
      if (change.added > 0) {
        text = `Agregaste ${productName}. Cantidad en el carrito: ${change.quantity}.`;
        if (change.limitedBy) text += ` ${limitMessage(change.limitedBy, limits, maxQuantityOf(productId))}`;
        setItems(change.items);
      } else {
        text = limitMessage(change.limitedBy ?? 'product_limit', limits, maxQuantityOf(productId));
      }
      setFeedback({ productId, text, ok: change.added > 0, at: Date.now() });
      setAnnouncement(text);
      opener.current = document.activeElement as HTMLElement | null;
      setIsOpen(true);
    },
    [refreshQuote],
  );

  const setQuantity = useCallback((productId: string, quantity: number) => {
    const limits = quoteRef.current?.limits;
    if (!limits) return;
    const change = setLineQuantity(itemsRef.current, productId, quantity, limits, maxQuantityOf(productId));
    setItems(change.items);
    const name = quoteRef.current?.lines.find((l) => l.productId === productId)?.name ?? 'el producto';
    const text = change.limitedBy
      ? limitMessage(change.limitedBy, limits, maxQuantityOf(productId))
      : `Cantidad de ${name}: ${change.quantity}.`;
    setFeedback({ productId, text, ok: !change.limitedBy, at: Date.now() });
    setAnnouncement(text);
  }, []);

  const remove = useCallback((productId: string) => {
    const name = quoteRef.current?.lines.find((l) => l.productId === productId)?.name ?? 'El producto';
    setItems((prev) => removeFromCart(prev, productId));
    setFeedback(null);
    setAnnouncement(`${name} se quitó del carrito.`);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    snapshot.current = new Map();
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      hydrated,
      items,
      units: totalUnits(items),
      limits: quote?.limits ?? null,
      quote,
      quoting,
      quoteError,
      notices,
      feedback,
      isOpen,
      open,
      close,
      add,
      setQuantity,
      remove,
      dismissNotices: () => setNotices([]),
      refreshQuote,
      clear,
      checkoutAvailable,
    }),
    [hydrated, items, quote, quoting, quoteError, notices, feedback, isOpen, open, close, add, setQuantity, remove, refreshQuote, clear, checkoutAvailable],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer />
      {/* avisos para lectores de pantalla (agregar, cambios de cantidad, precios y disponibilidad) */}
      <div className="cart-sr-only" role="status" aria-live="polite" data-testid="cart-announcer">
        {announcement}
      </div>
    </CartContext.Provider>
  );
}

export { quantityOf };
