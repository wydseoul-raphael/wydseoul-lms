import { Metadata } from 'next'
import React from 'react'
import ClientAdminLayout from './ClientAdminLayout'

export const metadata: Metadata = {
  title: 'WYD SEOUL 2027 Dashboard',
}

async function DashboardLayout(
  props: {
    children: React.ReactNode
    params: Promise<any>
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  return (
    <>
      <ClientAdminLayout
        params={params}>
        {children}
      </ClientAdminLayout>
    </>
  )
}

export default DashboardLayout
