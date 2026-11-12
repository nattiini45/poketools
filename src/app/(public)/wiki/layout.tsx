import WikiAttribution from '@/components/wiki/WikiAttribution';
import WikiHeader from '@/components/wiki/WikiHeader';

export default function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <WikiHeader />
      {children}
      <WikiAttribution />
    </div>
  );
}
