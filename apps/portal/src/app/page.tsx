import { redirect } from 'next/navigation';

export default function HomePage() {
  // Redirect to dashboard if logged in, otherwise to login
  redirect('/login');
}
