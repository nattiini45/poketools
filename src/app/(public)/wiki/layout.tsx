import WikiAttribution from '@/components/wiki/WikiAttribution';

export default function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <WikiAttribution />
    </>
  );
}
