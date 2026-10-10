'use client'
import React from 'react'
import { WydTextPage } from '@components/Wyd/WydTextPage'

export default function AboutClient() {
  return (
    <WydTextPage
      eyebrowKey="wyd.nav.about"
      titleKey="wyd.home.title"
      leadKey="wyd.about.lead"
      sections={[
        { titleKey: 'wyd.about.purpose', bodyKey: 'wyd.about.purposeBody' },
        { titleKey: 'wyd.about.learningFlow', bodyKey: 'wyd.about.learningFlowBody' },
        { titleKey: 'wyd.about.multilingual', bodyKey: 'wyd.about.multilingualBody' },
      ]}
    />
  )
}
