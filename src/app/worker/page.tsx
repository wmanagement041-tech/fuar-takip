import { getActiveAssignment, getTodayStats, getAllActiveStands } from '@/app/actions/worker'
import { getWorkerSession } from '@/lib/auth'
import { WorkerDashboard } from '@/components/worker/WorkerDashboard'

export default async function WorkerPage() {
  const session = await getWorkerSession()
  if (!session) {
    return null 
  }

  const workerName = session.worker?.name ?? session.name ?? 'Çalışan'

  const { success, assignment, error } = await getActiveAssignment()

  if (!success || !assignment) {
    const { stands } = await getAllActiveStands()
    return (
      <WorkerDashboard
        workerName={workerName}
        assignment={null}
        availableStands={stands || []}
        initialStats={{ totalRevenue: 0, totalCount: 0 }}
        initialItemCounts={{}}
      />
    )
  }

  const todayData = await getTodayStats(assignment.id)

  return (
    <WorkerDashboard
      workerName={workerName}
      assignment={assignment}
      availableStands={[]}
      initialStats={todayData.success ? (todayData.stats ?? { totalRevenue: 0, totalCount: 0 }) : { totalRevenue: 0, totalCount: 0 }}
      initialItemCounts={todayData.success ? (todayData.itemCounts ?? {}) : {}}
    />
  )
}
