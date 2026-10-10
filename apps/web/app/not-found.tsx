import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { WYD_BRAND } from '@/lib/wyd/brand'

// Root 404 is a server component (no i18n context), so the copy is bilingual
// Korean/English — the two primary languages of the learning center.
export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-wyd-canvas px-6">
      <div className="pb-12">
        <Image
          quality={100}
          width={220}
          height={121}
          src={WYD_BRAND.assets.logoPng}
          alt={WYD_BRAND.name}
          priority
        />
      </div>
      <div className="space-y-4 text-center">
        <p className="text-xs font-black tracking-[0.16em] text-wyd-blue">404</p>
        <h1 className="text-3xl sm:text-4xl font-black text-wyd-navy tracking-tight">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-base text-wyd-muted leading-relaxed max-w-md">
          요청하신 페이지가 삭제되었거나 주소가 잘못되었습니다.
          <span className="block">The page you are looking for does not exist or has moved.</span>
        </p>
      </div>
      <div className="pt-8 flex flex-col items-center">
        <Link
          href="/"
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-wyd-blue px-6 text-base font-bold text-white shadow-md transition-colors hover:bg-wyd-blue-dark"
        >
          홈으로 돌아가기 · Go home
          <ArrowRight className="transition-transform duration-150 ease-in-out" size={18} />
        </Link>
      </div>
    </div>
  )
}
