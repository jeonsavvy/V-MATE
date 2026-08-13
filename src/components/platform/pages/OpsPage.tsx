import { useEffect, useState } from 'react'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ContentReport, OwnerOpsDashboard } from '@/lib/platform/types'
import { PlatformApiError, platformApi } from '@/lib/platform/apiClient'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, LoadingState, PageSection } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import { PageFrame, ProtectedGate, safeActionError } from '@/components/platform/shared/PageFrame'

// 운영 화면은 owner 전용 노출 제어와 홈 배너 제어만 다룬다.
export function OpsPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [dashboard, setDashboard] = useState<OwnerOpsDashboard | null>(null)
  const [reports, setReports] = useState<ContentReport[]>([])
  const [isForbidden, setIsForbidden] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ entityType: 'character' | 'world'; id: string; name: string } | null>(null)

  const loadDashboard = () => {
    setLoadError('')
    void Promise.all([platformApi.fetchOpsDashboard(), platformApi.fetchReports('open')])
      .then(([data, reportPayload]) => {
        if (!data) {
          setDashboard(null)
          setReports([])
          setIsForbidden(false)
          setLoadError('현재 운영 상태를 확인하지 못했습니다. 다시 불러와 주세요.')
          return
        }
        setDashboard(data)
        setReports(reportPayload.reports)
        setIsForbidden(false)
      })
      .catch((error) => {
        if (error instanceof PlatformApiError && error.status === 403) {
          setIsForbidden(true)
          return
        }
        setLoadError('운영 데이터를 불러오지 못했습니다. 다시 시도해 주세요.')
      })
  }

  const reviewReport = (reportId: string, action: 'dismiss' | 'restore' | 'quarantine' | 'remove') => {
    void platformApi.applyReportAction(reportId, action)
      .then(loadDashboard)
      .catch((error) => toast.error(safeActionError(error, '신고 상태를 변경하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.')))
  }

  useEffect(() => {
    if (!chrome.user) return
    loadDashboard()
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="운영자 계정으로 로그인해 주세요." />
  }

  if (isForbidden) {
    return (
      <PageFrame chrome={chrome} showCombinationDock={false}>
        <EmptyState title="운영 권한이 없습니다" description="운영자 계정으로 로그인해 주세요." />
      </PageFrame>
    )
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
          <DialogHeader>
            <DialogTitle className="text-[#171717]">{pendingDelete?.name} 삭제</DialogTitle>
            <DialogDescription className="text-[#737373]">삭제하면 연결된 자산과 관련 방이 함께 사라질 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-[#ff5148]/30 bg-[#ff5148]/10 px-4 py-4 text-sm text-[#4d4d4d]">
            {pendingDelete?.name}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>취소</Button>
            <Button className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={() => {
              if (!pendingDelete) return
              void platformApi.deleteContent(pendingDelete.entityType, pendingDelete.id)
                .then(() => {
                  toast.success('삭제했습니다.')
                  setPendingDelete(null)
                  loadDashboard()
                })
                .catch((error) => toast.error(safeActionError(error, '콘텐츠 삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와 현재 상태를 확인해 주세요.')))
            }}>
              <Trash2 className="h-4 w-4" />삭제
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {!dashboard ? (
        loadError ? <EmptyState title="운영 데이터를 불러오지 못했습니다" description={loadError} action={<Button onClick={loadDashboard}>다시 불러오기</Button>} /> : <LoadingState label="운영 데이터 불러오는 중…" />
      ) : (
        <div className="space-y-6">
          <PageSection title={`신고 큐 ${reports.length ? `(${reports.length})` : ''}`}>
            {reports.length === 0 ? <EmptyState title="검토할 신고가 없습니다" description="새 신고가 들어오면 콘텐츠와 사유가 여기에 표시됩니다." /> : <div className="space-y-3">{reports.map((report) => <div key={report.id} className="rounded-lg border border-[#e7e7e7] bg-[#ffffff] p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-bold text-[#171717]">{report.entityName}</p><p className="mt-1 text-xs font-semibold text-[#c9342f]">{report.entityType === 'character' ? '캐릭터' : '월드'} · {report.reason}</p>{report.details ? <p className="mt-2 break-words text-sm text-[#666666]">{report.details}</p> : null}</div><div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap"><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'dismiss')}>기각</Button><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'restore')}>복구</Button><Button size="sm" className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={() => reviewReport(report.id, 'quarantine')}>격리</Button><Button size="sm" variant="destructive" onClick={() => reviewReport(report.id, 'remove')}>차단</Button></div></div></div>)}</div>}
          </PageSection>
          <PageSection title="콘텐츠 관리">
            <div className="space-y-4">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-[#171717]">캐릭터 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleCharacters, entityType: 'character' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenCharacters, entityType: 'character' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                      <p className="text-sm font-semibold text-[#171717]">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 break-words text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                                <Button variant="outline" className={`${section.visible ? 'border-[#d8d8d8] text-[#555] hover:bg-[#f5f5f5]' : 'border-[#b9d8c5] text-[#28643f] hover:bg-[#eef8f1]'} flex-1 sm:flex-none`} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('character', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(safeActionError(error, `${verb} 처리하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.`)))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="flex-1 border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717] sm:flex-none" onClick={() => setPendingDelete({ entityType: 'character', id: item.id, name: item.name })}>
                                  <Trash2 className="h-4 w-4" />삭제
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-[#171717]">월드 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleWorlds, entityType: 'world' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenWorlds, entityType: 'world' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                      <p className="text-sm font-semibold text-[#171717]">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 break-words text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                                <Button variant="outline" className={`${section.visible ? 'border-[#d8d8d8] text-[#555] hover:bg-[#f5f5f5]' : 'border-[#b9d8c5] text-[#28643f] hover:bg-[#eef8f1]'} flex-1 sm:flex-none`} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('world', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(safeActionError(error, `${verb} 처리하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.`)))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="flex-1 border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717] sm:flex-none" onClick={() => setPendingDelete({ entityType: 'world', id: item.id, name: item.name })}>
                                  <Trash2 className="h-4 w-4" />삭제
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
            </div>
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}
