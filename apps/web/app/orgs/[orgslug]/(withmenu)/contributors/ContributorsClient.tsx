'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WydTextPage } from '@components/Wyd/WydTextPage'

// Team sections. Names are filled in by the operations team through the
// `wyd.contributors.*Members` keys; until then each team renders its label.
export default function ContributorsClient() {
  const { t } = useTranslation()
  const members = (key: string): string[] | undefined => {
    const raw = t(key, { defaultValue: '' })
    const list = raw.split('|').map((s) => s.trim()).filter(Boolean)
    return list.length ? list : undefined
  }
  return (
    <WydTextPage
      eyebrowKey="wyd.footer.contributors"
      titleKey="wyd.contributors.title"
      leadKey="wyd.contributors.lead"
      sections={[
        { titleKey: 'wyd.contributors.educationTeam', bodyKey: 'wyd.contributors.lead', items: members('wyd.contributors.educationTeamMembers') },
        { titleKey: 'wyd.contributors.translationTeam', bodyKey: 'wyd.contributors.lead', items: members('wyd.contributors.translationTeamMembers') },
        { titleKey: 'wyd.contributors.videoTeam', bodyKey: 'wyd.contributors.lead', items: members('wyd.contributors.videoTeamMembers') },
        { titleKey: 'wyd.contributors.platformTeam', bodyKey: 'wyd.contributors.lead', items: members('wyd.contributors.platformTeamMembers') },
      ]}
    />
  )
}
