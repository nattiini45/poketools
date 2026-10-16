export default function BroadcastLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-transparent">{children}</div>;
}
