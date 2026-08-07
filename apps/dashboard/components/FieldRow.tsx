export function FieldRow({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 border-b border-border py-2.5 text-[13px] last:border-b-0">
      <dt className="font-mono text-[12px] text-mute">{name}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint">
        {title}
      </h2>
      <dl className="rounded-[3px] border border-border bg-white px-4">{children}</dl>
    </section>
  );
}
