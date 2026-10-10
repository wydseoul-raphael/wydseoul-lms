'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { JsonLd } from '@components/SEO/JsonLd'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { WYD_BRAND } from '@/lib/wyd/brand'
import WydHome from '@components/Wyd/Home/WydHome'

// The WYD SEOUL 2027 home page. The LearnHouse landing builder
// (LandingClassic/LandingCustom) is no longer rendered here; the home is a
// fixed WYD composition so operations never has to maintain it in the admin.
export default function HomeClient({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org?.name || WYD_BRAND.name,
    description: org?.description || WYD_BRAND.description,
    url: getUriWithOrg(orgslug, '/'),
    logo: org?.logo_image
      ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)
      : getUriWithoutOrg(WYD_BRAND.assets.logoPng),
  }

  return (
    <div className="w-full">
      <JsonLd data={orgJsonLd} />
      <WydHome orgslug={orgslug} />
    </div>
  )
}
