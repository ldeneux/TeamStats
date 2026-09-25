import './globals.css';
export const metadata = { title: 'Sathonay Basket Stats' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-court min-h-screen text-slate-800 antialiased">{children}</body>
    </html>
  );
}