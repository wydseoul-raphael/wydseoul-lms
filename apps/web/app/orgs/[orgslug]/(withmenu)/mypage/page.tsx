import { redirect } from 'next/navigation'

// "마이페이지" → the account settings. Browser-relative path (see account/page.tsx).
export default function MyPage() {
  redirect('/account/general')
}
