import './globals.css';

export const metadata = {
  title: 'Sathonay Basket Stats',
  description: 'Suivi de match en direct - Sathonay Basket',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-950 min-h-screen text-slate-100 antialiased">{children}</body>
    </html>
  );
}
