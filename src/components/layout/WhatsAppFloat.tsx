import { WHATSAPP_URL } from '@/lib/site';

export default function WhatsAppFloat() {
  return (
    <a href={WHATSAPP_URL} className="whatsapp-float" target="_blank">
      <img src="/img/whatsapp-icon.png" alt="WhatsApp" />
    </a>
  );
}
