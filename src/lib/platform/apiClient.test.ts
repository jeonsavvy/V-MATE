import { describe, expect, it } from 'vitest'
import { PlatformApiError, toUserFacingError } from '@/lib/platform/apiClient'

describe('safe API error mapping', () => {
  it('maps authentication and unavailable target codes without retaining provider text', () => {
    expect(toUserFacingError(new PlatformApiError({ status: 401, code: 'AUTH_UNAUTHORIZED' })).recovery).toBe('login')
    expect(toUserFacingError(new PlatformApiError({ status: 404, code: 'ROOM_TARGET_UNAVAILABLE' })).recovery).toBe('home')
    expect(toUserFacingError(new Error('upstream provider stack trace'), '저장하지 못했습니다.').message).toBe('저장하지 못했습니다.')
  })

  it('describes deletion commit-unknown and partial account states without claiming data was preserved', () => {
    expect(toUserFacingError(new PlatformApiError({ status: 503, code: 'CONTENT_DELETE_STATE_UNKNOWN' }))).toMatchObject({ recovery: 'library' })
    expect(toUserFacingError(new PlatformApiError({ status: 503, code: 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN' })).message).toContain('일부의 정리 상태')
    expect(toUserFacingError(new PlatformApiError({ status: 503, code: 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED' })).message).toContain('업로드 이미지는 정리되었습니다')
    expect(toUserFacingError(new PlatformApiError({ status: 503, code: 'ACCOUNT_DELETE_STATE_UNKNOWN' }))).toMatchObject({ recovery: 'login' })
  })
})
