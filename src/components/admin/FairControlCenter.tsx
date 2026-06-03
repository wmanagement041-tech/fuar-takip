'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { endAssignment, addTransactionAsAdmin } from '@/app/actions/admin'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, ArrowLeft, StopCircle, FileJson, Store, UserCircle2, BarChart3, Minus, Plus, Trash2, CreditCard, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { StatsModal } from '@/components/admin/StatsModal'

// ✅ FIX: UTC ISO → yerel tarih string'e çevirme (Türkiye UTC+3 dahil tüm bölgeler için doğru)
function toLocalDate(isoStr: string): string {
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Bugünün yerel tarih string'i
function todayLocal(): string {
  return toLocalDate(new Date().toISOString())
}

export function FairControlCenter({ 
  fair, 
  initialAssignments, 
  templates, 
  allWorkers,
  initialTransactions 
}: { 
  fair: any, 
  initialAssignments: any[], 
  templates: any[], 
  allWorkers: any[],
  initialTransactions: any[]
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [now, setNow] = useState(new Date())
  // ✅ FIX: filterDate başlangıç değeri artık yerel tarihe göre
  const [filterDate, setFilterDate] = useState(() => todayLocal())
  const [mounted, setMounted] = useState(false)
  const [showStats, setShowStats] = useState(false)
  // Admin ürün ekleme state'i
  const [addingItem, setAddingItem] = useState<{ id: string; name: string; price: number; category: string } | null>(null)
  const [addingItemLoading, setAddingItemLoading] = useState(false)

  useEffect(() => {
    setMounted(true)
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const fetchTransactionWithWorker = async (newTx: any) => {
      const activeAssignmentIds = assignments.filter(a => !a.end_time).map(a => a.id)
      if (!activeAssignmentIds.includes(newTx.assignment_id)) return

      // Fetch worker name for the new transaction via assignment join
      const { data: assignmentData } = await supabase
        .from('assignments')
        .select('workers(name)')
        .eq('id', newTx.assignment_id)
        .single()

      const workerName = (assignmentData?.workers as any)?.name || 'Bilinmiyor'
      const enrichedTx = { ...newTx, worker_name: workerName }

      setTransactions((prev: any[]) => [enrichedTx, ...prev])
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(50)
    }

    const channel = supabase
      .channel(`public:transactions:fair-${fair.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
        fetchTransactionWithWorker(payload.new)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, assignments, fair.id])

  const handleAddItemTransaction = async (method: 'Nakit' | 'IBAN') => {
    if (!addingItem) return
    const item = addingItem
    setAddingItem(null)
    setAddingItemLoading(true)

    // Optimistic: fake transaction to update UI instantly
    const fakeTx = {
      id: `tmp-${Date.now()}`,
      assignment_id: '',
      worker_id: '',
      item_id: item.id,
      item_name: item.name,
      amount: item.price,
      payment_method: method,
      category: item.category,
      created_at: new Date().toISOString(),
      worker_name: 'Admin',
    }
    setTransactions((prev: any[]) => [fakeTx, ...prev])

    const res = await addTransactionAsAdmin(fair.id, item.id, item.name, item.price, method, item.category)
    setAddingItemLoading(false)

    if (res.success) {
      toast.success(`${item.name} (${method}) eklendi`, { description: `+${item.price} ₺` })
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(100)
    } else {
      // Revert optimistic
      setTransactions((prev: any[]) => prev.filter(t => t.id !== fakeTx.id))
      toast.error('Hata', { description: res.error })
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100])
    }
  }

  const handleStopWorker = async (assignmentId: string) => {
    if (!confirm('Bu çalışanı sahadan çekmek istediğinize emin misiniz?')) return
    const res = await endAssignment(assignmentId)
    if (res.success) {
      toast.success('Çalışan sahadan çekildi.')
      setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, end_time: new Date().toISOString() } : a))
    } else toast.error(res.error)
  }

  const handleDeleteLastItemTransaction = async (itemId: string, itemName: string) => {
    if (!confirm(`${itemName} için en son yapılan satışı iptal etmek istediğinize emin misiniz?`)) return
    
    // Gerçek DB kaydı olan (tmp- ile başlamayan) en son transaction'ı bul
    const txToDelete = filteredTransactions.find(
      tx => (tx.item_id === itemId || tx.item_name === itemName) && !String(tx.id).startsWith('tmp-')
    )
    if (!txToDelete) {
      toast.error('İptal edilecek kayıtlı satış bulunamadı.')
      return
    }

    const { error } = await supabase.from('transactions').delete().eq('id', txToDelete.id)
    if (error) {
      toast.error('İptal edilirken hata oluştu: ' + error.message)
    } else {
      toast.success(`${itemName} satışı iptal edildi.`)
      setTransactions(prev => prev.filter(t => t.id !== txToDelete.id))
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([50, 50])
    }
  }

  const handleDeleteSpecificTransaction = async (txId: string) => {
    if (!confirm('Bu işlemi tamamen silmek istediğinize emin misiniz?')) return

    // Optimistic (henüz DB'ye yazılmamış) kayıt — sadece local state'den kaldır
    if (String(txId).startsWith('tmp-')) {
      setTransactions(prev => prev.filter(t => t.id !== txId))
      toast.success('İşlem iptal edildi.')
      return
    }
    
    const { error } = await supabase.from('transactions').delete().eq('id', txId)
    if (error) {
      toast.error('Silinirken hata oluştu: ' + error.message)
    } else {
      toast.success('İşlem silindi.')
      setTransactions(prev => prev.filter(t => t.id !== txId))
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([50, 50])
    }
  }

  // ✅ FIX: Artık UTC yerine yerel tarihe göre filtreleme
  const filteredTransactions = useMemo(() => {
    if (filterDate === 'all') return transactions
    return transactions.filter(tx => toLocalDate(tx.created_at) === filterDate)
  }, [transactions, filterDate])

  const filteredAssignments = useMemo(() => {
    if (filterDate === 'all') return assignments
    return assignments.filter(a => {
      const startDate = toLocalDate(a.start_time)
      const endDate = a.end_time ? toLocalDate(a.end_time) : todayLocal()
      return startDate <= filterDate && endDate >= filterDate
    })
  }, [assignments, filterDate])

  // ✅ FIX: Dropdown tarih listesi de yerel tarihe göre
  const distinctDates = useMemo(() => {
    const dates = new Set(transactions.map(t => toLocalDate(t.created_at)))
    const today = todayLocal()
    dates.add(today)
    return Array.from(dates).sort((a, b) => b.localeCompare(a))
  }, [transactions])

  const standTallies = useMemo(() => {
    const itemTallies = fair.template?.items?.map((item: any) => {
      const itemTxs = filteredTransactions.filter(tx => tx.item_id === item.id)
      const count = itemTxs.length
      const nakitTotal = itemTxs.filter(tx => tx.payment_method !== 'IBAN').reduce((sum, tx) => sum + Number(tx.amount), 0)
      const ibanTotal = itemTxs.filter(tx => tx.payment_method === 'IBAN').reduce((sum, tx) => sum + Number(tx.amount), 0)
      return { id: item.id, name: item.name, price: item.price, category: item.category || 'Genel', count, nakitTotal, ibanTotal, total: count * item.price }
    }) || []

    const templateItemIds = itemTallies.map((i: any) => i.id)
    const otherTxs = filteredTransactions.filter(tx => !templateItemIds.includes(tx.item_id))
    const otherCounts = otherTxs.reduce((acc: any, tx) => {
      const key = tx.item_id || tx.item_name
      if (!acc[key]) acc[key] = { id: key, name: tx.item_name, category: tx.category || 'Özel Satış', count: 0, total: 0, nakitTotal: 0, ibanTotal: 0 }
      acc[key].count++
      acc[key].total += Number(tx.amount)
      if (tx.payment_method === 'IBAN') acc[key].ibanTotal += Number(tx.amount)
      else acc[key].nakitTotal += Number(tx.amount)
      return acc
    }, {})

    return [...itemTallies, ...Object.values(otherCounts)]
  }, [filteredTransactions, fair.template])

  const totalFairRevenue = filteredTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0)
  const totalNakit = filteredTransactions.filter(tx => tx.payment_method !== 'IBAN').reduce((sum, tx) => sum + Number(tx.amount), 0)
  const totalIban = filteredTransactions.filter(tx => tx.payment_method === 'IBAN').reduce((sum, tx) => sum + Number(tx.amount), 0)

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {
      'Boyama': 0,
      'Peluş': 0,
      'Balon': 0,
      'Taç': 0,
      'Özel Satış': 0
    }
    standTallies.forEach((tally: any) => {
      const cat = tally.category || 'Genel'
      if (totals[cat] === undefined) totals[cat] = 0
      totals[cat] += tally.total
    })
    return totals
  }, [standTallies])

  const activeWorkers = assignments.filter(a => !a.end_time)

  return (
    <>
      <div className="space-y-12 animate-in fade-in duration-700">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-zinc-900">
          <div className="space-y-4">
            <Link href="/admin" className="inline-flex items-center text-zinc-500 hover:text-zinc-100 transition-colors text-sm font-medium">
              <ArrowLeft className="w-4 h-4 mr-2" /> Fuarlara Dön
            </Link>
            <div>
              <h1 className="text-3xl md:text-5xl font-medium tracking-tight text-zinc-100 flex items-center gap-4">
                <Store className="w-10 h-10 text-indigo-400" />
                {fair.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <span className="flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-2" />
                  SABİT STANT
                </span>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-zinc-500" />
                  <Select value={filterDate} onValueChange={(val) => val && setFilterDate(val)}>
                    <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-800 text-zinc-300 w-auto min-w-[140px]">
                      <SelectValue placeholder="Tarih Seçin" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                      <SelectItem value="all">Tüm Zamanlar</SelectItem>
                      {distinctDates.map((date: string) => (
                        <SelectItem key={date} value={date}>
                          {/* ✅ FIX: Tarihi T12:00:00 ile parse ederek timezone kaymasını önle */}
                          {new Date(date + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                          {date === todayLocal() ? ' (Bugün)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {mounted && (
                  <span className="text-zinc-600 text-xs font-mono ml-2 border-l border-zinc-800 pl-4 hidden md:inline-block">
                    {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>
              {activeWorkers.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="text-xs text-zinc-500 flex items-center mr-2">Şu An Sahada:</span>
                  {activeWorkers.map(a => (
                    <span key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400 text-[11px] border border-indigo-500/20">
                      <UserCircle2 className="w-3.5 h-3.5" />
                      {a.workers?.name}
                      <button onClick={() => handleStopWorker(a.id)} className="ml-1 text-indigo-400 hover:text-red-400 transition-colors">
                        <StopCircle className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-left md:text-right flex flex-col gap-3">
            <div>
              <p className="text-zinc-500 font-medium mb-1 text-sm uppercase tracking-wider">
                {filterDate === 'all' ? 'Tüm Zamanlar Ciro' : `Günlük Ciro (${new Date(filterDate + 'T12:00:00').toLocaleDateString('tr-TR')})`}
              </p>
              <div className="text-4xl md:text-5xl font-light text-zinc-100 tracking-tight">
                {totalFairRevenue.toLocaleString('tr-TR')} <span className="text-zinc-600">₺</span>
              </div>
              <div className="flex items-center justify-start md:justify-end gap-3 mt-2 text-xs font-medium">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Nakit: {totalNakit.toLocaleString('tr-TR')} ₺
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  IBAN: {totalIban.toLocaleString('tr-TR')} ₺
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-start md:justify-end gap-2 text-xs">
              {Object.entries(categoryTotals).map(([cat, total]) => (
                <span key={cat} className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {cat}: {total.toLocaleString('tr-TR')} ₺
                </span>
              ))}
            </div>
            {/* ✅ İstatistik Butonu */}
            <button
              onClick={() => setShowStats(true)}
              className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 text-indigo-400 text-sm font-medium transition-all hover:border-indigo-500/50 self-start md:self-end"
            >
              <BarChart3 className="w-4 h-4" />
              Detaylı İstatistikler
            </button>
          </div>
        </div>

        {/* Unified Stand Tally Board */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Col: Master Item Ledger */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl border border-zinc-800/60 overflow-hidden">
              <div className="p-6 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/20">
                <div>
                  <h2 className="text-xl font-medium text-zinc-100 flex items-center gap-2">
                    <FileJson className="w-5 h-5 text-indigo-400" />
                    {fair.template?.name || 'Şablon Yok'}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">Bu stanttaki tüm ürün satış adetleri</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-zinc-300">Toplam İşlem: {filteredTransactions.length}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-3">
                  {standTallies.length === 0 ? (
                    <p className="text-zinc-500 text-sm text-center py-4">Bu tarih için hiç satış bulunmuyor.</p>
                  ) : (
                    standTallies.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 hover:bg-zinc-900/80 transition-colors group/item">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium ${item.count > 0 ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/20' : 'bg-zinc-800 text-zinc-500'}`}>
                            {item.count}
                          </div>
                          <div>
                            <p className={`text-base font-medium ${item.count > 0 ? 'text-zinc-100' : 'text-zinc-500'}`}>
                              {item.name}
                              {item.category && <span className="ml-2 text-[10px] text-zinc-500 uppercase tracking-widest bg-zinc-800/50 px-1.5 py-0.5 rounded">{item.category}</span>}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs">
                              <span className="text-zinc-600">{item.price ? `${item.price} ₺ / adet` : 'Özel Satış Fiyatı'}</span>
                              {item.count > 0 && (
                                <div className="flex gap-2">
                                  <span className="text-emerald-500/70">{item.nakitTotal.toLocaleString('tr-TR')} ₺ Nakit</span>
                                  <span className="text-zinc-700">|</span>
                                  <span className="text-indigo-400/70">{item.ibanTotal.toLocaleString('tr-TR')} ₺ IBAN</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          <p className={`text-lg font-medium min-w-[60px] text-right ${item.count > 0 ? 'text-indigo-400' : 'text-zinc-600'}`}>
                            {item.total.toLocaleString('tr-TR')} ₺
                          </p>
                          {/* + Ekle butonu — her zaman görünür */}
                          {item.price > 0 && (
                            <button
                              onClick={() => setAddingItem({ id: item.id, name: item.name, price: item.price, category: item.category || 'Genel' })}
                              disabled={addingItemLoading}
                              className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors flex-shrink-0 disabled:opacity-40"
                              title="Satış Ekle"
                            >
                              <Plus className="w-4 h-4" strokeWidth={2.5} />
                            </button>
                          )}
                          {/* — Sil butonu — yalnızca count > 0 iken */}
                          <button
                            onClick={() => handleDeleteLastItemTransaction(item.id, item.name)}
                            disabled={item.count === 0}
                            className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 hover:text-red-300 transition-colors flex-shrink-0 disabled:opacity-25 disabled:cursor-not-allowed"
                            title="Son Satışı İptal Et"
                          >
                            <Minus className="w-4 h-4" strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Col: Transaction Logs */}
          <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl border border-zinc-800/60 overflow-hidden flex flex-col max-h-[800px]">
            <div className="p-6 border-b border-zinc-800/60 bg-zinc-900/20">
              <h2 className="text-xl font-medium text-zinc-100">İşlem Logu</h2>
              <p className="text-xs text-zinc-500 mt-1">Anlık satış dökümü</p>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-3">
              {filteredTransactions.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-4">İşlem bulunmuyor.</p>
              ) : (
                filteredTransactions.map((tx: any) => (
                  <div key={tx.id} className="flex items-start justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/40 hover:bg-zinc-900/80 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 shrink-0 mt-1.5" />
                      <div>
                        <p className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                          {tx.item_name}
                          {tx.category && <span className="text-[9px] text-zinc-500 uppercase tracking-widest bg-zinc-800/50 px-1 rounded">{tx.category}</span>}
                        </p>
                        {tx.description && (
                          <p className="text-xs text-zinc-400 italic mt-0.5">"{tx.description}"</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[10px] text-zinc-600">
                            {/* ✅ FIX: Log'da gösterilen saat artık yerel saate göre doğru */}
                            {new Date(tx.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tx.payment_method === 'IBAN' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                            {tx.payment_method || 'Nakit'}
                          </span>
                        </div>
                        {/* ✅ NEW: İşlemi Yapan */}
                        {tx.worker_name && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <UserCircle2 className="w-3 h-3 text-zinc-600" />
                            <span className="text-[10px] text-zinc-500">
                              İşlemi Yapan: <span className="text-zinc-400 font-medium">{tx.worker_name}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <p className="text-sm font-medium text-emerald-400">+{Number(tx.amount).toLocaleString('tr-TR')} ₺</p>
                      <button
                        onClick={() => handleDeleteSpecificTransaction(tx.id)}
                        className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 hover:text-red-300 transition-colors"
                        title="İşlemi Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detaylı İstatistik Modalı */}
      <StatsModal
        open={showStats}
        onClose={() => setShowStats(false)}
        fair={fair}
        assignments={assignments}
        transactions={transactions}
        initialFilterDate={filterDate}
        allWorkers={allWorkers}
      />

      {/* Admin Ürün Ekleme — Ödeme Yöntemi Dialog */}
      {addingItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setAddingItem(null)}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 text-center border-b border-zinc-800/60 bg-zinc-900/30">
              <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-1">Admin — Satış Ekle</p>
              <h3 className="text-xl font-medium text-zinc-100">{addingItem.name}</h3>
              <p className="text-sm text-zinc-400 mt-1">{addingItem.price.toLocaleString('tr-TR')} ₺</p>
            </div>
            {/* Buttons */}
            <div className="flex p-4 gap-3">
              <button
                onClick={() => handleAddItemTransaction('Nakit')}
                className="flex-1 h-16 flex flex-col gap-1 items-center justify-center rounded-2xl bg-zinc-900 hover:bg-emerald-950/40 border border-zinc-700 hover:border-emerald-700/50 text-zinc-100 transition-all"
              >
                <Banknote className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-medium">Nakit</span>
              </button>
              <button
                onClick={() => handleAddItemTransaction('IBAN')}
                className="flex-1 h-16 flex flex-col gap-1 items-center justify-center rounded-2xl bg-zinc-900 hover:bg-indigo-950/40 border border-zinc-700 hover:border-indigo-700/50 text-zinc-100 transition-all"
              >
                <CreditCard className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-medium">IBAN</span>
              </button>
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={() => setAddingItem(null)}
                className="w-full py-2.5 rounded-xl text-zinc-500 hover:text-zinc-300 text-sm transition-colors border border-zinc-800 hover:border-zinc-700"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
