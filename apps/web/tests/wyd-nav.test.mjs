import { describe, expect, test } from 'bun:test'
import { WYD_NAV, visibleNavItems, isActivePath } from '../components/Wyd/wydNav.ts'

describe('visibleNavItems', () => {
  test('guests see about + preview only', () => {
    const keys = visibleNavItems(WYD_NAV, 'unauthenticated').map((i) => i.key)
    expect(keys).toEqual(['about', 'preview'])
  })

  test('signed-in learners see learning, enroll and mypage but not preview', () => {
    const keys = visibleNavItems(WYD_NAV, 'authenticated').map((i) => i.key)
    expect(keys).toEqual(['about', 'learning', 'enroll', 'mypage'])
  })

  test('while loading only public items render', () => {
    const keys = visibleNavItems(WYD_NAV, 'loading').map((i) => i.key)
    expect(keys).toEqual(['about'])
  })
})

describe('isActivePath', () => {
  test('exact and nested matches', () => {
    expect(isActivePath('/about', '/about')).toBe(true)
    expect(isActivePath('/about/', '/about')).toBe(true)
    expect(isActivePath('/learning/course', '/learning')).toBe(true)
    expect(isActivePath('/aboutus', '/about')).toBe(false)
  })

  test('home only matches exactly', () => {
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/about', '/')).toBe(false)
    expect(isActivePath(null, '/')).toBe(false)
  })
})
