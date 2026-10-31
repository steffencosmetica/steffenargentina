import Image from 'next/image';

/** Producto sin fotografía: el isotipo de Steffen en lugar de un recuadro vacío. */
export default function NoImage() {
  return (
    <span className="store-noimg" data-testid="store-noimg">
      <Image src="/img/logito.png" alt="" width={96} height={96} />
      <span className="store-sr-only">Sin fotografía</span>
    </span>
  );
}
