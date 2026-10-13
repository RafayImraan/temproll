import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Temproll',
  description: 'Payroll policy checks and manually executed test-token schedules on Ethereum Sepolia.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
