/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Ticket, 
  UserPlus, 
  Volume2, 
  History, 
  Monitor, 
  RefreshCw,
  Play,
  Plus,
  Settings2,
  X,
  Edit2,
  Check,
  Printer,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface QueueItem {
  id: string;
  number: number;
  timestamp: number;
  status: 'waiting' | 'calling' | 'served';
  counterId: string;
  counterName: string;
}

interface Counter {
  id: string;
  name: string;
  prefix: string;
  currentTicket: QueueItem | null;
  queue: QueueItem[];
  nextNumber: number;
}

export default function App() {
  const [counters, setCounters] = useState<Counter[]>([
    { id: '1', name: 'Loket A', prefix: 'A', currentTicket: null, queue: [], nextNumber: 1 }
  ]);
  const [history, setHistory] = useState<QueueItem[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [autoPrint, setAutoPrint] = useState(true);
  const [ticketToPrint, setTicketToPrint] = useState<QueueItem | null>(null);

  // Audio context for playing raw PCM from TTS
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };
    window.addEventListener('click', initAudio, { once: true });
    return () => window.removeEventListener('click', initAudio);
  }, []);

  // Automatic print effect
  useEffect(() => {
    if (ticketToPrint && autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ticketToPrint, autoPrint]);

  const handleManualPrint = (ticket: QueueItem) => {
    setTicketToPrint(ticket);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const playAudio = async (base64Data: string) => {
    if (!audioContextRef.current) return;

    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, bytes.length / 2, 24000);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer);

      for (let i = 0; i < channelData.length; i++) {
        channelData[i] = view.getInt16(i * 2, true) / 32768.0;
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
      
      return new Promise((resolve) => {
        source.onended = resolve;
      });
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  };

  const callTicketVoice = async (number: number, prefix: string, counterName: string) => {
    setIsCalling(true);
    try {
      // Improved prompt for more natural Indonesian pronunciation
      const prompt = `Nomor antrian, ${prefix}, ${number}. Silahkan menuju, ${counterName}.`;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        await playAudio(base64Audio);
      }
    } catch (error) {
      console.error("TTS Error:", error);
    } finally {
      setIsCalling(false);
    }
  };

  const addTicket = (counterId: string) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter) return;

    const newTicket: QueueItem = {
      id: Math.random().toString(36).substr(2, 9),
      number: counter.nextNumber,
      timestamp: Date.now(),
      status: 'waiting',
      counterId: counter.id,
      counterName: counter.name,
    };

    setCounters(prev => prev.map(c => 
      c.id === counterId 
        ? { ...c, queue: [...c.queue, newTicket], nextNumber: c.nextNumber + 1 } 
        : c
    ));
    setTicketToPrint(newTicket);
  };

  const callNext = async (counterId: string) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter || counter.queue.length === 0 || isCalling) return;

    const next = counter.queue[0];
    const remaining = counter.queue.slice(1);

    if (counter.currentTicket) {
      setHistory(prev => [counter.currentTicket!, ...prev].slice(0, 10));
    }

    const callingTicket: QueueItem = { ...next, status: 'calling' };
    
    setCounters(prev => prev.map(c => 
      c.id === counterId ? { ...c, currentTicket: callingTicket, queue: remaining } : c
    ));

    await callTicketVoice(next.number, counter.prefix, counter.name);
    
    setCounters(prev => prev.map(c => 
      c.id === counterId ? { ...c, currentTicket: { ...callingTicket, status: 'served' } } : c
    ));
  };

  const reCall = async (counterId: string) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter || !counter.currentTicket || isCalling) return;
    
    await callTicketVoice(counter.currentTicket.number, counter.prefix, counter.name);
  };

  const addCounter = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const count = counters.length;
    const prefix = String.fromCharCode(65 + count); // A, B, C...
    setCounters([...counters, { 
      id: newId, 
      name: `Loket ${prefix}`, 
      prefix: prefix,
      currentTicket: null, 
      queue: [], 
      nextNumber: 1 
    }]);
  };

  const updateCounterName = (id: string, newName: string) => {
    setCounters(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
  };

  const updateCounterPrefix = (id: string, newPrefix: string) => {
    setCounters(prev => prev.map(c => c.id === id ? { ...c, prefix: newPrefix.toUpperCase() } : c));
  };

  const removeCounter = (id: string) => {
    if (counters.length <= 1) return;
    setCounters(prev => prev.filter(c => c.id !== id));
  };

  const resetQueue = () => {
    setCounters(prev => prev.map(c => ({ ...c, currentTicket: null, queue: [], nextNumber: 1 })));
    setHistory([]);
    setShowResetConfirm(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans print-hidden">
      {/* Print Section (Hidden in UI) */}
      <div className="hidden print:block print-only print:p-8 print:text-center print:bg-white">
        <div className="border-2 border-dashed border-slate-400 p-8 inline-block min-w-[300px]">
          <h1 className="text-2xl font-bold mb-2">TIKET ANTRIAN</h1>
          <p className="text-sm font-bold text-indigo-600 mb-1">{ticketToPrint?.counterName}</p>
          <p className="text-[10px] text-slate-500 mb-6">{new Date().toLocaleString()}</p>
          <div className="text-6xl font-black mb-4">
            {counters.find(c => c.id === ticketToPrint?.counterId)?.prefix || ''}{ticketToPrint?.number.toString().padStart(3, '0')}
          </div>
          <p className="text-sm font-medium">Mohon menunggu giliran Anda</p>
          <div className="mt-8 pt-4 border-t border-slate-200 text-[10px] text-slate-400">
            Terima kasih atas kunjungan Anda
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 print-hidden">
        
        {/* Main Display Section */}
        <div className="lg:col-span-2 space-y-8">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-200 shadow-lg">
                <Monitor className="text-white w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Sistem Antrian Loket Mandiri</h1>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 text-slate-400 hover:text-rose-500 transition-colors text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </header>

          {/* Counters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {counters.map((counter) => (
              <motion.div 
                key={counter.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden border border-slate-100 flex flex-col group"
              >
                <div className="bg-indigo-600 px-6 py-3 flex justify-between items-center group-hover:bg-indigo-700 transition-colors">
                  <span className="text-indigo-100 font-bold uppercase tracking-wider text-xs">{counter.name}</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${counter.currentTicket?.status === 'calling' ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <span className="text-indigo-100 text-[10px] font-medium">
                      {counter.queue.length} Menunggu
                    </span>
                  </div>
                </div>
                
                <div className="p-8 flex flex-col items-center justify-center text-center flex-grow bg-gradient-to-b from-white to-slate-50/50">
                  <AnimatePresence mode="wait">
                    {counter.currentTicket ? (
                      <motion.div
                        key={counter.currentTicket.id}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 1.1, opacity: 0 }}
                        className="space-y-1"
                      >
                        <div className="text-7xl font-black text-indigo-600 tracking-tighter font-mono">
                          {counter.prefix}{counter.currentTicket.number.toString().padStart(3, '0')}
                        </div>
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Sekarang Dilayani</p>
                      </motion.div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="py-6"
                      >
                        <div className="text-slate-200 text-3xl font-bold italic">Standby</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="p-4 bg-white border-t border-slate-100 flex flex-col gap-3">
                  <div className="grid grid-cols-4 gap-3">
                    <button 
                      onClick={() => addTicket(counter.id)}
                      className="col-span-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-md shadow-emerald-100 text-xs"
                    >
                      <UserPlus className="w-5 h-5" />
                      <span>Ambil Tiket</span>
                    </button>
                    <button 
                      onClick={() => ticketToPrint && handleManualPrint(ticketToPrint)}
                      disabled={!ticketToPrint}
                      className="col-span-1 bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-indigo-600 rounded-2xl transition-all flex items-center justify-center active:scale-95 border border-slate-200"
                      title="Cetak Ulang Tiket Terakhir"
                    >
                      <Printer className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => callNext(counter.id)}
                      disabled={counter.queue.length === 0 || isCalling}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-4 rounded-2xl transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-md shadow-indigo-100 text-xs"
                    >
                      <Volume2 className="w-5 h-5" />
                      <span>Berikutnya</span>
                    </button>
                    <button 
                      onClick={() => reCall(counter.id)}
                      disabled={!counter.currentTicket || isCalling}
                      className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white font-bold py-4 rounded-2xl transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-md shadow-amber-100 text-xs"
                    >
                      <RefreshCw className="w-5 h-5" />
                      <span>Ulang</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex items-start gap-4">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Printer className="text-white w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-indigo-900 text-sm">Sistem Antrian Mandiri</h3>
              <p className="text-indigo-700/70 text-xs leading-relaxed">
                Setiap loket memiliki urutan antrian masing-masing. Silahkan ambil tiket pada loket yang sesuai dengan kebutuhan Anda. Tiket akan otomatis dicetak setelah tombol "Ambil Tiket" ditekan (jika fitur Auto-Print aktif).
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar Section */}
        <div className="space-y-8">
          {/* Settings Section (Permanent) */}
          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Settings2 className="w-5 h-5 text-indigo-500" />
                <h2 className="font-bold text-slate-700 uppercase tracking-wider text-xs">Pengaturan Loket</h2>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Auto Print Toggle */}
              <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <Printer className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Auto-Print Tiket</span>
                </div>
                <button 
                  onClick={() => setAutoPrint(!autoPrint)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${autoPrint ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <motion.div 
                    animate={{ x: autoPrint ? 26 : 2 }}
                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                  />
                </button>
              </div>

              <div className="h-px bg-slate-100" />

              {counters.map((counter) => (
                <div key={counter.id} className="space-y-2 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Konfigurasi Loket</span>
                    <button 
                      onClick={() => removeCounter(counter.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input 
                      className="col-span-1 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={counter.prefix}
                      maxLength={1}
                      onChange={(e) => updateCounterPrefix(counter.id, e.target.value)}
                      placeholder="Pfx"
                      title="Prefix Tiket"
                    />
                    <input 
                      className="col-span-3 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={counter.name}
                      onChange={(e) => updateCounterName(counter.id, e.target.value)}
                      placeholder="Nama Loket"
                    />
                  </div>
                </div>
              ))}
              <button 
                onClick={addCounter}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-all flex items-center justify-center gap-2 text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                Tambah Loket
              </button>
            </div>
          </div>

          {/* History Section */}
          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center gap-3">
              <History className="w-5 h-5 text-slate-400" />
              <h2 className="font-bold text-slate-700 uppercase tracking-wider text-xs">Riwayat Panggilan</h2>
            </div>
            <div className="p-2 max-h-[400px] overflow-y-auto">
              {history.length > 0 ? (
                <div className="space-y-1">
                  {history.map((item, idx) => (
                    <div 
                      key={item.id}
                      className={`p-4 rounded-2xl flex items-center justify-between ${idx === 0 ? 'bg-indigo-50/50' : ''}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold font-mono text-xs ${idx === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {counters.find(c => c.id === item.counterId)?.prefix}{item.number}
                        </div>
                        <div>
                          <p className={`font-bold text-xs ${idx === 0 ? 'text-indigo-900' : 'text-slate-600'}`}>
                            {item.counterName}
                          </p>
                          <p className="text-[9px] text-slate-400 font-medium">{new Date(item.timestamp).toLocaleTimeString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => handleManualPrint(item)}
                          className="p-2 hover:bg-white rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                          title="Cetak Ulang"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => callTicketVoice(item.number, counters.find(c => c.id === item.counterId)?.prefix || '', item.counterName)}
                          disabled={isCalling}
                          className="p-2 hover:bg-white rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                          title="Panggil Ulang"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-slate-300 font-medium italic text-sm">Belum ada riwayat</div>
              )}
            </div>
          </div>

          {/* Summary Card */}
          <div className="bg-indigo-900 rounded-3xl p-8 text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
            <div className="relative z-10 space-y-6">
              <div className="space-y-1">
                <p className="text-indigo-300 text-[10px] font-bold uppercase tracking-widest">Status Antrian</p>
                <p className="text-2xl font-black">Sistem Aktif</p>
              </div>
              <div className="h-px bg-indigo-800" />
              <div className="space-y-4">
                {counters.map(c => (
                  <div key={c.id} className="bg-indigo-800/40 p-4 rounded-2xl border border-indigo-700/50 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <span className="text-indigo-300 text-[9px] font-bold uppercase tracking-widest leading-none block">{c.name}</span>
                        <div className="text-xl font-black font-mono leading-none">
                          {c.currentTicket ? `${c.prefix}${c.currentTicket.number.toString().padStart(3, '0')}` : '---'}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-indigo-400 block uppercase font-bold tracking-tighter">Menunggu</span>
                        <span className="text-sm font-black leading-none">{c.queue.length}</span>
                      </div>
                    </div>
                    
                    {c.queue.length > 0 && (
                      <div className="pt-2 border-t border-indigo-700/30">
                        <p className="text-[8px] text-indigo-400 uppercase font-bold tracking-widest mb-1.5">Daftar Tunggu:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.queue.map(q => (
                            <span 
                              key={q.id} 
                              className="bg-indigo-700/50 text-indigo-100 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border border-indigo-600/30"
                            >
                              {c.prefix}{q.number.toString().padStart(3, '0')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-indigo-800/50 rounded-full blur-2xl" />
          </div>
        </div>

      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showResetConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="bg-rose-100 p-4 rounded-2xl">
                  <AlertCircle className="w-8 h-8 text-rose-600" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-800">Reset Semua Antrian?</h3>
                  <p className="text-slate-500 text-sm">Tindakan ini akan menghapus seluruh daftar antrian dan riwayat hari ini. Data tidak dapat dikembalikan.</p>
                </div>
                <div className="flex gap-3 w-full pt-4">
                  <button 
                    onClick={() => setShowResetConfirm(false)}
                    className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors text-sm"
                  >
                    Batal
                  </button>
                  <button 
                    onClick={resetQueue}
                    className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-rose-100 text-sm flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Ya, Reset
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
