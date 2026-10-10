import { GraduationCap } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.learning-management',
  titleKey: 'dashboard.learning_management.title',
  descriptionKey: 'dashboard.learning_management.subtitle',
  keywordsKey: 'dashboard.learning_management.keywords',
  icon: GraduationCap,
  href: '/dash/learning-management',
  group: 'analytics',
}
