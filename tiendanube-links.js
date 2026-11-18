/* Verified manually against the exact Tiendanube product pages. No API or automatic sync.
 * Update price and checkedOn together after verifying. Delete price to hide it.
 * Optional terms must be exact verified copy: installmentsText, transferText, promotionText.
 */
(function () {
'use strict';
const products = [
  {
    "id": "triple-argan",
    "name": "Emulsión Argan Triple Accion 180 cc",
    "presentation": "180 cc",
    "url": "https://steffenargentina.com/productos/emulsion-argan-triple-accion-180-cc1/",
    "price": 10320,
    "currency": "ARS",
    "checkedOn": "2026-11-18",
    "image": "img/destacados/triple-argan.webp",
    "imageSource": "https://dcdn-us.mitiendanube.com/stores/008/508/101/products/tripleargan180-0681353db49e31a5c117946099341353-640-0.webp",
    "installmentsText": "3 x $ 3.440,00 sin interés",
    "transferText": "$9.288,00 con Transferencia"
  },
  {
    "id": "brillo-lino",
    "name": "Brillo Semi de Lino 125cc",
    "presentation": "125 cc",
    "url": "https://steffenargentina.com/productos/brillo-semi-de-lino-125cc1/",
    "price": 16095,
    "currency": "ARS",
    "checkedOn": "2026-11-18",
    "image": "img/destacados/brillo-lino.webp",
    "imageSource": "https://dcdn-us.mitiendanube.com/stores/008/508/101/products/brillo-aaeec694566f9dec2817946102959532-640-0.webp",
    "installmentsText": "3 x $ 5.365,00 sin interés",
    "transferText": "$14.485,50 con Transferencia"
  },
  {
    "id": "biphase-keratina",
    "name": "Bi- phase Keratina 200 ml",
    "presentation": "200 ml",
    "url": "https://steffenargentina.com/productos/bi-phase-keratina-200-ml1/",
    "price": 11202,
    "currency": "ARS",
    "checkedOn": "2026-11-18",
    "image": "img/destacados/biphase-keratina.webp",
    "imageSource": "https://dcdn-us.mitiendanube.com/stores/008/508/101/products/biphase1-15cbdfa396974039b917946113685507-640-0.webp",
    "installmentsText": "3 x $ 3.734,00 sin interés",
    "transferText": "$10.081,80 con Transferencia"
  },
  {
    "id": "serum-lino",
    "name": "Reparador de puntas Cristal Semi de Lino 75cc",
    "presentation": "75 cc",
    "url": "https://steffenargentina.com/productos/reparador-de-puntas-cristal-semi-de-lino-75cc1/",
    "price": 15255,
    "currency": "ARS",
    "checkedOn": "2026-11-18",
    "image": "img/destacados/serum-lino.webp",
    "imageSource": "https://dcdn-us.mitiendanube.com/stores/008/508/101/products/recarga-14265c30e1fdad173c17946097296997-640-0.webp",
    "installmentsText": "3 x $ 5.085,00 sin interés",
    "transferText": "$13.729,50 con Transferencia"
  },
  {
    "id": "serum-lino",
    "name": "Reparador de puntas Cristal Semi de Lino 30cc",
    "presentation": "30 cc",
    "url": "https://steffenargentina.com/productos/reparador-de-puntas-cristal-semi-de-lino-30cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "serum-coco",
    "name": "Serum Capilar Aceite de Coco 30cc",
    "presentation": "30 cc",
    "url": "https://steffenargentina.com/productos/serum-capilar-aceite-de-coco-30cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "bioesfera",
    "name": "Bioesfera de Keratina 30cc",
    "presentation": "30 cc",
    "url": "https://steffenargentina.com/productos/bioesfera-de-keratina-30cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "biphase-lino",
    "name": "Bi- phase Semi de Lino 200 ml",
    "presentation": "200 ml",
    "url": "https://steffenargentina.com/productos/bi-phase-semi-de-lino-200-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "biphase-coco",
    "name": "Bi- phase Coconut 200 ml",
    "presentation": "200 ml",
    "url": "https://steffenargentina.com/productos/bi-phase-coconut-200-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "triple-lino",
    "name": "Emulsión Semi de Lino Triple Accion 180 cc",
    "presentation": "180 cc",
    "url": "https://steffenargentina.com/productos/emulsion-semi-de-lino-triple-accion-180-cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "triple-keratina",
    "name": "Emulsión Keratina Triple Accion 180 cc",
    "presentation": "180 cc",
    "url": "https://steffenargentina.com/productos/emulsion-keratina-triple-accion-180-cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "triple-coco",
    "name": "Emulsión Coconut Triple Accion 180 cc",
    "presentation": "180 cc",
    "url": "https://steffenargentina.com/productos/emulsion-coconut-triple-accion-180-cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "brillo-lino",
    "name": "Brillo Semi de Lino 75cc",
    "presentation": "75 cc",
    "url": "https://steffenargentina.com/productos/brillo-semi-de-lino-75cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-keratina",
    "name": "Shampoo Keratina 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-keratina-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-keratina",
    "name": "Shampoo Keratina 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-keratina-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-keratina",
    "name": "Acondicionador Keratina 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-keratina-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-keratina",
    "name": "Acondicionador Keratina 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-keratina-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-semi-de-lino",
    "name": "Shampoo Semi de Lino 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-semi-de-lino-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-semi-de-lino",
    "name": "Shampoo Semi de Lino 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-semi-de-lino-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-semi-de-lino",
    "name": "Acondicionador Semi de Lino 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-semi-de-lino-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-semi-de-lino",
    "name": "Acondicionador Semi de Lino 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-semi-de-lino-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-extra-acido",
    "name": "Shampoo Extra Ácido 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-extra-acido-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-extra-acido",
    "name": "Shampoo Extra Ácido 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-extra-acido-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-extra-acido",
    "name": "Acondicionador Extra Ácido 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-extra-acido-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-extra-acido",
    "name": "Acondicionador Extra Ácido 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-extra-acido-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-argan",
    "name": "Shampoo Argán 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-argan-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-argan",
    "name": "Shampoo Argán 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-argan-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-argan",
    "name": "Acondicionador Argán 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-argan-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-argan",
    "name": "Acondicionador Argán 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-argan-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-neutro",
    "name": "Shampoo Neutro 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-neutro-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-neutro",
    "name": "Shampoo Neutro 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-neutro-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-coconut",
    "name": "Shampoo Línea Coconut 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/shampoo-aceite-de-coco-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "shampoo-coconut",
    "name": "Shampoo Línea Coconut 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/shampoo-aceite-de-coco-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-coconut",
    "name": "Acondicionador Línea Coconut 350 ml",
    "presentation": "350 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-aceite-de-coco-350-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "acondicionador-coconut",
    "name": "Acondicionador Línea Coconut 1000 ml",
    "presentation": "1000 ml",
    "url": "https://steffenargentina.com/productos/acondicionador-aceite-de-coco-1000-ml1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-coconut",
    "name": "Máscara capilar Línea Coconut 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/nutricion-con-aceite-de-coco-250cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-argan",
    "name": "Máscara capilar Olio de Argán 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/tratamiento-de-argan-250cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-argan",
    "name": "Máscara capilar Olio de Argán 1000 cc",
    "presentation": "1000 cc",
    "url": "https://steffenargentina.com/productos/tratamiento-de-argan-1000cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-extra-acido",
    "name": "Máscara capilar Extra Ácido 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/extra-acido-250cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-extra-acido",
    "name": "Máscara capilar Extra Ácido 1000 cc",
    "presentation": "1000 cc",
    "url": "https://steffenargentina.com/productos/extra-acido-1000cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-semi-de-lino",
    "name": "Máscara capilar Nutrición Semi de Lino 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/nutricion-semi-de-lino-250cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-semi-de-lino",
    "name": "Máscara capilar Nutrición Semi de Lino 1000 cc",
    "presentation": "1000 cc",
    "url": "https://steffenargentina.com/productos/nutricion-semi-de-lino-1000cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-keratina",
    "name": "Máscara capilar Nutrición + Keratina 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/nutricion-keratina-250cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-keratina",
    "name": "Máscara capilar Nutrición + Keratina 1000 cc",
    "presentation": "1000 cc",
    "url": "https://steffenargentina.com/productos/nutricion-keratina-1000cc1/",
    "checkedOn": "2026-11-18"
  },
  {
    "id": "mascara-bano-de-luz",
    "name": "Máscara capilar Baño de Luz 250 cc",
    "presentation": "250 cc",
    "url": "https://steffenargentina.com/productos/tratamiento-de-luz-250cc1/",
    "checkedOn": "2026-11-18"
  }
];
products.forEach(function(product) {
 let url;try {url=new URL(product.url);}catch(_){return;}
 if(url.protocol!=='https:'||url.hostname!=='steffenargentina.com'||!url.pathname.startsWith('/productos/')||!product.presentation||!product.name)return;
 function link(featured){const a=document.createElement('a');a.href=url.href;a.className=featured?'featured-buy':'buy-online';a.textContent=featured?'Comprar':'Comprar online · '+product.presentation;a.setAttribute('aria-label','Comprar '+product.name);return a;}
 document.querySelectorAll('[data-product-id]').forEach(function(slot){if(slot.dataset.productId===product.id)slot.appendChild(link(false));});
 document.querySelectorAll('[data-featured-product]').forEach(function(card){if(card.dataset.featuredProduct!==product.id || (card.dataset.presentation && card.dataset.presentation!==product.presentation))return;const area=card.querySelector('.featured-commerce');if(!area)return;
 const image=card.querySelector('img');
 if(image && image.parentElement.tagName!=='A') {
   const imageLink=document.createElement('a');
   imageLink.className='featured-image-link';
   imageLink.href=url.href;
   imageLink.setAttribute('aria-label','Ver '+product.name+' en Tiendanube');
   image.replaceWith(imageLink);imageLink.appendChild(image);
 }

 if(Number.isFinite(product.price)&&product.price>0&&product.currency==='ARS'){const price=document.createElement('p');price.className='featured-price';price.textContent=new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(product.price);area.appendChild(price);}
 ['installmentsText','transferText','promotionText'].forEach(function(key){if(!product[key])return;const text=document.createElement('p');text.className='featured-terms '+(key==='transferText'?'featured-transfer':key==='installmentsText'?'featured-installments':'');text.textContent=product[key];area.appendChild(text);});area.appendChild(link(true));});
});
})();
