'use client'
import React from 'react'
import { WydTextPage } from '@components/Wyd/WydTextPage'

export default function CopyrightClient() {
  return (
    <WydTextPage
      eyebrowKey="wyd.footer.copyright"
      titleKey="wyd.copyright.title"
      leadKey="wyd.copyright.lead"
      sections={[
        { titleKey: 'wyd.copyright.educationalUse', bodyKey: 'wyd.copyright.educationalUseBody' },
        { titleKey: 'wyd.copyright.redistribution', bodyKey: 'wyd.copyright.redistributionBody' },
        { titleKey: 'wyd.copyright.attribution', bodyKey: 'wyd.copyright.attributionBody' },
      ]}
    />
  )
}
