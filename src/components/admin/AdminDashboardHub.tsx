'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  createFair, createTemplate, updateTemplate,
  deleteTemplate, createWorker, payWorker, deleteWorker, updateWorker,
  updateFair, deleteFair
} from '@/app/actions/admin'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  Plus, Calendar, FileJson, ChevronRight,
  Trash2, Edit2, Users, Clock, Banknote, CheckCircle2, ShoppingBag
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

// ---------- helpers ----------
function calcWorkerPayment(worker: any) {
  const hourlyWage = Number(worker.hourly_wage ?? 0)
  const assignments: any[] = worker.assignments ?? []

  // sadece bitmiş + ödenmemiş görevler
  const unpaid = assignments.filter((a: any) => a.end_time && !a.is_paid)

  let totalMinutes = 0
  for (const a of unpaid) {
    const start = new Date(a.start_time).getTime()
    const end = new Date(a.end_time).getTime()
    totalMinutes += Math.max(0, (end - start) / 60000)
  }
  // Yuvarlama: Küsüratları en yakın 15 dakikaya (.25 sa) yuvarla
  const totalHours = totalMinutes / 60
  const finalHours = Math.round(totalHours * 4) / 4
  const totalPayment = finalHours * hourlyWage

  return { totalHours: finalHours, totalPayment: Math.round(totalPayment) }
}

function calcWorkerRevenueDetails(worker: any, filterDate: 'today' | 'all') {
  const assignments: any[] = worker.assignments ?? []
  let total = 0
  let nakit = 0
  let iban = 0

  let todayLocalStr = '';
  if (filterDate === 'today') {
    const d = new Date();
    todayLocalStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  for (const a of assignments) {
    const txs: any[] = a.transactions ?? []
    for (const tx of txs) {
      if (filterDate === 'today') {
        if (!tx.created_at) continue;
        const txDate = new Date(tx.created_at)
        const txLocalStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`
        if (txLocalStr !== todayLocalStr) continue
      }

      const amount = Number(tx.amount ?? 0)
      total += amount
      if (tx.payment_method === 'IBAN') {
        iban += amount
      } else {
        nakit += amount
      }
    }
  }
  return { total, nakit, iban }
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} dk`
  if (m === 0) return `${h} sa`
  return `${h} sa ${m} dk`
}

function getFairStatus(fair: any) {
  return 'live' as const // All stands are always live
}

// ---------- component ----------
export function AdminDashboardHub({
  fairs, templates, workers
}: {
  fairs: any[], templates: any[], workers: any[]
}) {
  const [fairOpen, setFairOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [workerOpen, setWorkerOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [editFair, setEditFair] = useState<any | null>(null)
  const [editFairName, setEditFairName] = useState('')
  const [editFairTemplate, setEditFairTemplate] = useState('')

  // Worker detail & edit modals
  const [detailWorker, setDetailWorker] = useState<any | null>(null)
  const [editWorker, setEditWorker] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editPin, setEditPin] = useState('')
  const [editWage, setEditWage] = useState('')

  // Worker Revenue Filter
  const [workerRevenueFilter, setWorkerRevenueFilter] = useState<'today' | 'all'>('today')

  // Template state
  const [templateItems, setTemplateItems] = useState([{ id: Math.random().toString(36).substring(7), name: '', price: 0, category: 'Genel' }])
  const [templateName, setTemplateName] = useState('')
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)

  // ---- Fair ----
  const handleCreateFair = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    const res = await createFair(new FormData(e.currentTarget))
    setLoading(false)
    if (res.success) { toast.success('Fuar oluşturuldu!'); setFairOpen(false) }
    else toast.error(res.error)
  }

  const handleUpdateFair = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editFair) return
    setLoading(true)
    const res = await updateFair(editFair.id, {
      name: editFairName,
      template_id: editFairTemplate
    })
    setLoading(false)
    if (res.success) {
      toast.success('Fuar güncellendi!')
      setEditFair(null)
    } else toast.error(res.error)
  }

  const handleDeleteFair = async (id: string, name: string) => {
    if (!confirm(`"${name}" fuarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return
    const res = await deleteFair(id)
    if (res.success) toast.success('Fuar silindi.')
    else toast.error(res.error)
  }

  const openEditFair = (fair: any) => {
    setEditFair(fair)
    setEditFairName(fair.name)
    setEditFairTemplate(fair.template_id || '')
  }

  // ---- Template ----
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = templateItems.filter(i => i.name.trim() !== '' && i.price > 0)
    if (!templateName || validItems.length === 0) {
      toast.error('İsim ve en az bir geçerli ürün giriniz.'); return
    }
    setLoading(true)
    const res = editingTemplateId
      ? await updateTemplate(editingTemplateId, templateName, validItems)
      : await createTemplate(templateName, validItems)
    setLoading(false)
    if (res.success) { toast.success(editingTemplateId ? 'Çizelge güncellendi!' : 'Çizelge oluşturuldu!'); resetTemplateForm() }
    else toast.error(res.error)
  }

  const resetTemplateForm = () => {
    setTemplateName(''); setTemplateItems([{ id: Math.random().toString(36).substring(7), name: '', price: 0, category: 'Genel' }])
    setEditingTemplateId(null); setTemplateOpen(false)
  }

  const openEditTemplate = (t: any) => {
    setTemplateName(t.name)
    setTemplateItems(t.items.map((i: any) => ({ id: i.id || Math.random().toString(36).substring(7), name: i.name, price: i.price, category: i.category || 'Genel' })))
    setEditingTemplateId(t.id); setTemplateOpen(true)
  }

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Bu çizelgeyi silmek istediğinize emin misiniz?')) return
    const res = await deleteTemplate(id)
    if (res.success) toast.success('Çizelge silindi.'); else toast.error(res.error)
  }

  // ---- Worker ----
  const handleCreateWorker = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    const res = await createWorker(new FormData(e.currentTarget))
    setLoading(false)
    if (res.success) { toast.success('Çalışan eklendi!'); setWorkerOpen(false) }
    else toast.error(res.error)
  }

  const handlePayWorker = async (workerId: string, workerName: string) => {
    if (!confirm(`${workerName} adlı çalışanın birikmiş ödemelerini ödendi olarak işaretlemek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return
    const res = await payWorker(workerId)
    if (res.success) toast.success('Ödeme yapıldı ve sıfırlandı!')
    else toast.error(res.error)
  }

  const handleDeleteWorker = async (workerId: string, workerName: string) => {
    if (!confirm(`${workerName} adlı çalışanı silmek istediğinize emin misiniz? Tüm kayıtları silinecek.`)) return
    const res = await deleteWorker(workerId)
    if (res.success) toast.success('Çalışan silindi.')
    else toast.error(res.error)
  }

  const openEdit = (worker: any) => {
    setEditWorker(worker)
    setEditName(worker.name)
    setEditPin(worker.pin || '')
    setEditWage(worker.hourly_wage ? String(worker.hourly_wage) : '')
  }

  const handleUpdateWorker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editWorker) return
    setLoading(true)
    const res = await updateWorker(editWorker.id, {
      name: editName,
      pin: editPin,
      hourly_wage: editWage ? Number(editWage) : null,
    })
    setLoading(false)
    if (res.success) {
      toast.success('Çalışan güncellendi!')
      setEditWorker(null)
    } else toast.error(res.error)
  }

  const workerStats = useMemo(() =>
    workers
      .filter(w => w.is_active !== false)
      .map(w => ({ ...w, ...calcWorkerPayment(w), revenueDetails: calcWorkerRevenueDetails(w, workerRevenueFilter) })),
    [workers, workerRevenueFilter]
  )

  const filteredFairs = fairs // All stands are always live; no status filtering needed

  return (
    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* STANDS SECTION */}
      <section>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-medium text-zinc-100 tracking-tight">Stantlar</h2>
          </div>
          <Dialog open={fairOpen} onOpenChange={setFairOpen}>
            <DialogTrigger render={<Button className="rounded-full shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] bg-indigo-600 hover:bg-indigo-500 text-white transition-all h-10 px-5" />}>
              <Plus className="w-4 h-4 mr-2" /> Yeni Stant
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100">
              <DialogHeader>
                <DialogTitle className="text-xl font-medium">Yeni Stant Oluştur</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateFair} className="space-y-5 mt-4">
                <div className="space-y-2">
                  <Label className="text-zinc-400">Stant Adı</Label>
                  <Input name="name" placeholder="Örn: Ana Stant" required className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400">Çizelge (Template)</Label>
                  <select name="template_id" required className="flex h-10 w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 ring-offset-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                    <option value="">Çizelge Seçin...</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={loading} className="w-full rounded-xl mt-4 h-12 text-md font-medium bg-indigo-600 hover:bg-indigo-500 text-white">
                  {loading ? 'Oluşturuluyor...' : 'Stant Oluştur'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFairs.length === 0 ? (
            <div className="col-span-full p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-3xl border border-dashed border-zinc-800/50">
              Henüz stant bulunmuyor. Yeni bir stant oluşturun.
            </div>
          ) : (
            filteredFairs.map((fair) => {
              const status = 'live'
              return (
                <div key={fair.id} className="relative group">
                  <Link href={`/admin/fairs/${fair.id}`}>
                    <Card className="cursor-pointer rounded-3xl border-zinc-800/60 bg-zinc-900/40 backdrop-blur-md shadow-lg hover:shadow-indigo-500/10 hover:border-zinc-700 transition-all overflow-hidden relative h-full">
                      <CardHeader className="bg-zinc-900/20 pb-5 border-b border-zinc-800/60">
                        <div className="flex justify-between items-start">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform duration-300">
                            <Calendar className="w-5 h-5" />
                          </div>
                          
                          {status === 'live' && (
                            <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full font-medium shadow-sm">
                              Aktif
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-xl mt-5 font-medium text-zinc-100 line-clamp-1">{fair.name}</CardTitle>
                        <CardDescription className="text-xs font-light text-zinc-500 flex gap-2 mt-1.5">
                          {fair.template ? (
                            <span>{fair.template.name}</span>
                          ) : (
                            <span>Çizelge seçilmemiş</span>
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-5 flex items-center justify-between text-sm text-zinc-400 font-light group-hover:text-zinc-200 transition-colors">
                        <span>Kontrol Merkezine Git</span>
                        <div className="w-8 h-8 rounded-full bg-zinc-800/50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                  
                  {/* Fuar Yönetim Butonları (Mobil cihazlarda hep görünür) */}
                  <div className="absolute top-16 right-4 flex gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
                    <Button 
                      variant="ghost" size="icon" 
                      className="w-8 h-8 rounded-full bg-zinc-900/80 border border-zinc-800 text-zinc-400 hover:text-indigo-400"
                      onClick={() => openEditFair(fair)}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button 
                      variant="ghost" size="icon" 
                      className="w-8 h-8 rounded-full bg-zinc-900/80 border border-zinc-800 text-zinc-400 hover:text-red-400"
                      onClick={() => handleDeleteFair(fair.id, fair.name)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* EDIT FAIR MODAL */}
      <Dialog open={!!editFair} onOpenChange={(o) => !o && setEditFair(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium">Stant Bilgilerini Düzenle</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateFair} className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label className="text-zinc-400">Stant Adı</Label>
              <Input 
                value={editFairName} 
                onChange={e => setEditFairName(e.target.value)} 
                required 
                className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">Çizelge (Template)</Label>
              <select 
                value={editFairTemplate}
                onChange={e => setEditFairTemplate(e.target.value)}
                required 
                className="flex h-10 w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 ring-offset-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Çizelge Seçin...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
              {loading ? 'Güncelleniyor...' : 'Stant Güncelle'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* TEMPLATES SECTION */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-medium text-zinc-100 tracking-tight">Çizelgeler (Şablonlar)</h2>
          <Dialog open={templateOpen} onOpenChange={(open) => { if (!open) resetTemplateForm(); setTemplateOpen(open) }}>
            <DialogTrigger render={<Button variant="outline" className="rounded-full border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all h-10 px-5" />}>
              <Plus className="w-4 h-4 mr-2" /> Yeni Çizelge
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 max-h-[85vh] overflow-y-auto custom-scrollbar">
              <DialogHeader>
                <DialogTitle className="text-xl font-medium">{editingTemplateId ? 'Çizelgeyi Düzenle' : 'Yeni Çizelge Hazırla'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateTemplate} className="space-y-5 mt-4">
                <div className="space-y-2">
                  <Label className="text-zinc-400">Çizelge Adı</Label>
                  <Input placeholder="Örn: 2024 Genel Stand" value={templateName} onChange={e => setTemplateName(e.target.value)} className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
                </div>
                <div className="space-y-4 pt-2">
                  <Label className="text-zinc-400">Satış Kalemleri (Butonlar)</Label>
                  {templateItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-3 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/60">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="w-full sm:w-[120px] shrink-0">
                          <Select 
                            value={item.category || 'Genel'} 
                            onValueChange={(val) => val && setTemplateItems(items => items.map(i => i.id === item.id ? { ...i, category: val } : i))}
                          >
                            <SelectTrigger className="h-10 rounded-lg bg-zinc-900 border-zinc-800 text-xs text-zinc-300 focus:ring-indigo-500">
                              <SelectValue placeholder="Kategori" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                              <SelectItem value="Genel">Genel</SelectItem>
                              <SelectItem value="Boyama">Boyama</SelectItem>
                              <SelectItem value="Peluş">Peluş</SelectItem>
                              <SelectItem value="Balon">Balon</SelectItem>
                              <SelectItem value="Taç">Taç</SelectItem>
                              <SelectItem value="Özel">Özel</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Input placeholder="Ürün Adı" value={item.name}
                          onChange={(e) => setTemplateItems(items => items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i))}
                          className="rounded-lg bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500 w-full sm:flex-1 text-sm" />
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-24">
                            <Input type="number" placeholder="Fiyat" value={item.price || ''}
                              onChange={(e) => setTemplateItems(items => items.map(i => i.id === item.id ? { ...i, price: Number(e.target.value) } : i))}
                              className="rounded-lg bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500 w-full pr-7 text-sm" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">₺</span>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg w-10 h-10 shrink-0"
                            onClick={() => { if (templateItems.length > 1) setTemplateItems(items => items.filter(i => i.id !== item.id)) }}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full rounded-xl border-dashed border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors h-12"
                    onClick={() => setTemplateItems([...templateItems, { id: Math.random().toString(36).substring(7), name: '', price: 0, category: 'Genel' }])}>
                    <Plus className="w-4 h-4 mr-2" /> Kalem Ekle
                  </Button>
                </div>
                <Button type="submit" disabled={loading} className="w-full rounded-xl mt-6 h-12 text-md font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
                  {loading ? 'Kaydediliyor...' : 'Çizelgeyi Kaydet'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.length === 0 ? (
            <div className="col-span-full p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-3xl border border-dashed border-zinc-800/50">
              Henüz çizelge bulunmuyor.
            </div>
          ) : (
            templates.map((template) => (
              <Card key={template.id} className="rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-md shadow-sm hover:border-zinc-700 transition-all relative group overflow-hidden">
                <CardHeader className="bg-zinc-900/20 pb-5 flex flex-row items-start justify-between border-b border-zinc-800/60">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-zinc-400 flex items-center justify-center mb-4">
                      <FileJson className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-lg font-medium text-zinc-100">{template.name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full" onClick={() => openEditTemplate(template)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-full" onClick={() => handleDeleteTemplate(template.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="flex flex-wrap gap-2">
                    {template.items?.map((item: any, i: number) => (
                      <Badge key={i} variant="secondary" className="rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700/50 font-light px-2.5 py-1">
                        {item.name} <span className="text-zinc-500 ml-1.5 font-medium">{item.price}₺</span>
                        {item.category && <span className="text-indigo-400/70 ml-1 text-[10px] uppercase">({item.category})</span>}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* WORKERS SECTION */}
      <section>
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-medium text-zinc-100 tracking-tight">Çalışanlar</h2>
            <Badge variant="secondary" className="rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              {workers.length} kişi
            </Badge>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full md:w-auto gap-4">
            <div className="flex bg-zinc-900/80 p-1 rounded-xl border border-zinc-800 self-start sm:self-auto">
              <button
                onClick={() => setWorkerRevenueFilter('today')}
                className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${workerRevenueFilter === 'today' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Bugün
              </button>
              <button
                onClick={() => setWorkerRevenueFilter('all')}
                className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${workerRevenueFilter === 'all' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Tümü
              </button>
            </div>

            <Dialog open={workerOpen} onOpenChange={setWorkerOpen}>
              <DialogTrigger render={<Button variant="outline" className="rounded-full border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all h-10 px-5 w-full sm:w-auto" />}>
                <Plus className="w-4 h-4 mr-2" /> Yeni Çalışan
              </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100">
              <DialogHeader>
                <DialogTitle className="text-xl font-medium">Sisteme Çalışan Ekle</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateWorker} className="space-y-5 mt-4">
                <div className="space-y-2">
                  <Label className="text-zinc-400">Ad Soyad</Label>
                  <Input name="name" placeholder="Örn: Osman Yılmaz" required className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400">PIN Kodu (4 haneli)</Label>
                  <Input name="pin" placeholder="Örn: 1234" maxLength={4} required className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400">Saatlik Ücret (₺)</Label>
                  <div className="relative">
                    <Input name="hourly_wage" type="number" placeholder="Örn: 150" className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500 pr-8" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">₺</span>
                  </div>
                  <p className="text-xs text-zinc-600">Boş bırakabilirsiniz. Sonradan düzenlenebilir.</p>
                </div>
                <Button type="submit" disabled={loading} className="w-full rounded-xl mt-4 h-12 text-md font-medium bg-indigo-600 hover:bg-indigo-500 text-white">
                  {loading ? 'Ekleniyor...' : 'Çalışanı Kaydet'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workerStats.length === 0 ? (
            <div className="col-span-full p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-3xl border border-dashed border-zinc-800/50">
              Henüz çalışan eklenmemiş. &quot;Yeni Çalışan&quot; butonuna tıklayın.
            </div>
          ) : (
            workerStats.map((worker) => (
              <Card
                key={worker.id}
                className="rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-md shadow-sm hover:border-zinc-700 transition-all relative group overflow-hidden cursor-pointer"
                onClick={() => setDetailWorker(worker)}
              >
                {/* Card Header */}
                <CardHeader className="bg-zinc-900/20 pb-4 flex flex-row items-start justify-between border-b border-zinc-800/60">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-medium text-zinc-100">{worker.name}</CardTitle>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {worker.hourly_wage ? `${Number(worker.hourly_wage).toLocaleString('tr-TR')} ₺/saat` : 'Ücret tanımlanmamış'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-zinc-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full"
                      onClick={(e) => { e.stopPropagation(); openEdit(worker) }}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-full"
                      onClick={(e) => { e.stopPropagation(); handleDeleteWorker(worker.id, worker.name) }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>

                {/* Stats */}
                <CardContent className="p-5 space-y-3">
                  {/* Ödenmemiş Süre + Hakediş */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-900/60 rounded-2xl p-3 border border-zinc-800/50">
                      <div className="flex items-center gap-1.5 text-zinc-500 text-xs mb-1.5">
                        <Clock className="w-3 h-3" /> Ödenmemiş Süre
                      </div>
                      <p className="text-xl font-medium text-zinc-100">
                        {worker.totalHours} <span className="text-sm text-zinc-500 font-normal">sa</span>
                      </p>
                    </div>
                    <div className="bg-zinc-900/60 rounded-2xl p-3 border border-zinc-800/50">
                      <div className="flex items-center gap-1.5 text-zinc-500 text-xs mb-1.5">
                        <Banknote className="w-3 h-3" /> Hakediş
                      </div>
                      <p className="text-xl font-medium text-indigo-400">
                        {worker.totalPayment.toLocaleString('tr-TR')} <span className="text-sm font-normal">₺</span>
                      </p>
                    </div>
                  </div>

                  {/* Yaptığı Ciro — yatay satır, butonun hemen üstünde */}
                  <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                        <ShoppingBag className="w-3 h-3 text-emerald-500/70" />
                        <span>Ciro {workerRevenueFilter === 'today' ? '(Bugün)' : '(Tümü)'}</span>
                      </div>
                      <span className="text-sm font-semibold text-emerald-400">
                        {worker.revenueDetails.total.toLocaleString('tr-TR')} ₺
                      </span>
                    </div>
                    
                    {worker.revenueDetails.total > 0 && (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-emerald-500/10">
                        <span className="text-[11px] font-medium text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded-md flex-1 text-center truncate">
                          Nakit: {worker.revenueDetails.nakit.toLocaleString('tr-TR')} ₺
                        </span>
                        <span className="text-[11px] font-medium text-indigo-400/80 bg-indigo-500/10 px-2 py-0.5 rounded-md flex-1 text-center truncate">
                          IBAN: {worker.revenueDetails.iban.toLocaleString('tr-TR')} ₺
                        </span>
                      </div>
                    )}
                  </div>

                  {worker.totalPayment > 0 ? (
                    <Button
                      onClick={(e) => { e.stopPropagation(); handlePayWorker(worker.id, worker.name) }}
                      className="w-full h-11 rounded-2xl bg-emerald-600/80 hover:bg-emerald-500 text-white border border-emerald-500/30 transition-all text-sm font-medium"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Öde ve Sıfırla ({worker.totalPayment.toLocaleString('tr-TR')} ₺)
                    </Button>
                  ) : (
                    <div className="w-full h-11 rounded-2xl bg-zinc-900/40 border border-zinc-800/40 flex items-center justify-center text-zinc-600 text-sm">
                      Birikmiş ödeme yok
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* WORKER DETAIL MODAL */}
      <Dialog open={!!detailWorker} onOpenChange={(o) => !o && setDetailWorker(null)}>
        <DialogContent className="sm:max-w-lg rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 max-h-[85vh] flex flex-col p-0 overflow-hidden">
          {detailWorker && (() => {
            const hw = Number(detailWorker.hourly_wage ?? 0)
            const allA: any[] = detailWorker.assignments ?? []
            const unpaid = allA.filter((a: any) => a.end_time && !a.is_paid)
            const paid = allA.filter((a: any) => a.end_time && a.is_paid)
            const renderRow = (a: any, isPaid: boolean) => {
              const mins = Math.max(0, (new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000)
              const hrs = mins / 60
              const earned = Math.round(hrs * hw)
              return (
                <div key={a.id} className={`flex items-start justify-between px-4 py-3 rounded-xl border transition-colors ${isPaid ? 'bg-zinc-900/20 border-zinc-800/30 opacity-60' : 'bg-zinc-900/50 border-zinc-800/60'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">{a.fairs?.name ?? 'Fuar Bilgisi Yok'}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {new Date(a.start_time).toLocaleDateString('tr-TR')} &nbsp;·&nbsp;
                      {formatMinutes(mins)} çalıştı
                    </p>
                    {a.templates?.name && <p className="text-[11px] text-zinc-600">{a.templates.name}</p>}
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <p className={`text-sm font-semibold ${isPaid ? 'text-zinc-500' : 'text-indigo-400'}`}>{earned.toLocaleString('tr-TR')} ₺</p>
                    <p className="text-[10px] text-zinc-600">{Math.round(hrs * 10) / 10} sa × {hw} ₺</p>
                    {isPaid && <span className="text-[10px] text-emerald-600">✔ ödendi</span>}
                  </div>
                </div>
              )
            }
            return (
              <>
                <div className="p-6 border-b border-zinc-800/60 bg-zinc-900/40">
                  <DialogTitle className="text-xl font-medium text-zinc-100 flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </span>
                    {detailWorker.name}
                  </DialogTitle>
                  <div className="flex gap-5 mt-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Saatlik Ücret</p>
                      <p className="text-base font-medium text-zinc-200">{hw > 0 ? `${hw} ₺/sa` : 'Tanımlanmamış'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Ödenmemiş Hakediş</p>
                      <p className="text-base font-semibold text-indigo-400">{detailWorker.totalPayment?.toLocaleString('tr-TR') ?? 0} ₺</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Ödenmemiş Süre</p>
                      <p className="text-base font-medium text-zinc-300">{detailWorker.totalHours ?? 0} sa</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                  {unpaid.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Ödenmemiş Görevler ({unpaid.length})</p>
                      {unpaid.map((a: any) => renderRow(a, false))}
                    </div>
                  )}
                  {paid.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Ödenen Görevler ({paid.length})</p>
                      {paid.map((a: any) => renderRow(a, true))}
                    </div>
                  )}
                  {allA.filter((a:any)=>a.end_time).length === 0 && (
                    <p className="text-zinc-600 text-center py-8">Henüz tamamlanmış görev yok.</p>
                  )}
                  {unpaid.length > 0 && (
                    <button
                      onClick={() => { handlePayWorker(detailWorker.id, detailWorker.name); setDetailWorker(null) }}
                      className="w-full h-11 rounded-2xl bg-emerald-600/80 hover:bg-emerald-500 text-white border border-emerald-500/30 transition-all text-sm font-medium flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Tümünü Öde ve Sıfırla ({detailWorker.totalPayment?.toLocaleString('tr-TR')} ₺)
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* WORKER EDIT MODAL */}
      <Dialog open={!!editWorker} onOpenChange={(o) => !o && setEditWorker(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium">Çalışanı Düzenle</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateWorker} className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label className="text-zinc-400">Ad Soyad</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} required className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">PIN Kodu</Label>
              <Input value={editPin} onChange={e => setEditPin(e.target.value)} maxLength={4} required className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500" />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">Saatlik Ücret (₺)</Label>
              <div className="relative">
                <Input type="number" value={editWage} onChange={e => setEditWage(e.target.value)} placeholder="Örn: 150" className="rounded-xl bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500 pr-8" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">₺</span>
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
              {loading ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
