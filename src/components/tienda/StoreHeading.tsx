// Kicker en itálica, título en mayúsculas y línea dorada: el mismo sistema que «Quiénes somos».
export default function StoreHeading({
  kicker,
  title,
  as: Tag = 'h2',
  reveal = false,
  id,
}: {
  kicker: string;
  title: string;
  as?: 'h1' | 'h2';
  reveal?: boolean;
  id?: string;
}) {
  const r = reveal ? ' reveal' : '';
  return (
    <header className="store-heading">
      <p className={`store-kicker${r}`}>{kicker}</p>
      <Tag className={`store-title${r}`} id={id}>
        {title}
      </Tag>
      <span className={`store-line${r}`} aria-hidden="true"></span>
    </header>
  );
}
