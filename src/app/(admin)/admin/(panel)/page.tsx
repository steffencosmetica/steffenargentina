import { redirect } from 'next/navigation';
import { HOME_PATH } from '@/lib/admin/routes';

export default function AdminHome() {
  redirect(HOME_PATH);
}
