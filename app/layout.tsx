import './globals.css';

export const metadata = { title: 'Sathonay Basket Tracker' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-100 min-h-screen text-gray-900">{children}</body>
    </html>
  );
}