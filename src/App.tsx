import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  getDocFromServer, 
  doc,
  deleteDoc,
  writeBatch,
  getDocs,
  where
} from 'firebase/firestore';
import { 
  Mic, 
  MicOff, 
  Map as MapIcon, 
  MapPin,
  Upload, 
  Download, 
  Trash2, 
  Activity,
  AlertCircle,
  Info,
  Settings,
  X,
  UserCircle,
  ChevronDown,
  Check,
  Leaf,
  Bird,
  Trees,
  Flower,
  Sun,
  Moon,
  ClipboardList
} from 'lucide-react';
import * as d3 from 'd3';
import Papa from 'papaparse';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';

import { 
  MapContainer, 
  TileLayer, 
  Circle, 
  Popup, 
  useMap 
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { db } from './firebase';
import { cn } from './lib/utils';
import { NoiseMeasurement, OperationType, FirestoreErrorInfo } from './types';

// --- Error Handling ---
function getNoiseColor(db: number) {
  return d3.scaleLinear<string>()
    .domain([0, 20, 40, 60, 80, 100, 120, 140])
    .range([
      "#10b981", // Emerald (Low)
      "#34d399", // Emerald Light
      "#fbbf24", // Amber (Med)
      "#f97316", // Orange
      "#ef4444", // Red (High)
      "#dc2626", // Red Dark
      "#7c3aed", // Violet (Extreme)
      "#4c1d95"  // Violet Dark
    ])(db);
}

function getNoiseQuality(db: number) {
  if (db < 30) return "Very Quiet";
  if (db < 60) return "Quiet";
  if (db < 80) return "Moderate";
  if (db < 100) return "Loud";
  if (db < 120) return "Very Loud";
  if (db < 140) return "Dangerous";
  return "Extreme";
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'public',
      email: 'public',
      emailVerified: false,
      isAnonymous: true,
      tenantId: '',
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsed = JSON.parse(state.error.message);
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 p-6">
          <div className="max-w-md w-full bg-white dark:bg-zinc-950 border border-red-500/30 rounded-xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">System Error</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              Restart Application
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Components ---

const FrequencySpectrum = ({ data }: { data: Uint8Array }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const margin = { bottom: 15 };
    const chartHeight = height - margin.bottom;
    const barWidth = width / data.length;

    // Draw bars
    svg.selectAll('rect')
      .data(Array.from(data))
      .join('rect')
      .attr('x', (_, i) => i * barWidth)
      .attr('y', d => chartHeight - (d / 255) * chartHeight)
      .attr('width', Math.max(0, barWidth - 1))
      .attr('height', d => (d / 255) * chartHeight)
      .attr('fill', d => d3.scaleLinear<string>()
        .domain([0, 64, 128, 192, 255])
        .range(["#10b981", "#fbbf24", "#f97316", "#ef4444", "#7c3aed"])(d));

    // Add labels if they don't exist
    if (svg.select('.labels').empty()) {
      const labels = svg.append('g').attr('class', 'labels');
      const labelPoints = [
        { x: 0, text: '20Hz' },
        { x: width * 0.25, text: '5kHz' },
        { x: width * 0.5, text: '10kHz' },
        { x: width * 0.75, text: '15kHz' },
        { x: width, text: '20kHz', anchor: 'end' }
      ];

      labels.selectAll('text')
        .data(labelPoints)
        .enter()
        .append('text')
        .attr('x', d => d.x)
        .attr('y', height - 2)
        .attr('text-anchor', d => d.anchor || 'start')
        .attr('fill', 'currentColor')
        .attr('class', 'text-slate-500 dark:text-slate-400')
        .attr('font-size', '8px')
        .attr('font-family', 'monospace')
        .text(d => d.text);
    }
  }, [data]);

  return (
    <div className="w-full h-32 bg-slate-100/50 dark:bg-slate-800/50 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};

const MapUpdater = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  useEffect(() => {
    if (center[0] !== 0 || center[1] !== 0) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
};

const NoiseHeatmap = ({ data, userLocation, theme, toggleTheme }: { data: NoiseMeasurement[], userLocation: { lat: number, lng: number } | null, theme: 'light' | 'dark', toggleTheme: () => void }) => {
  const [selectedPoint, setSelectedPoint] = useState<NoiseMeasurement | null>(null);

  const center = useMemo(() => {
    if (userLocation) return [userLocation.lat, userLocation.lng] as [number, number];
    if (data.length === 0) return [0, 0] as [number, number];
    const lat = data.reduce((acc, d) => acc + d.lat, 0) / data.length;
    const lng = data.reduce((acc, d) => acc + d.lng, 0) / data.length;
    return [lat, lng] as [number, number];
  }, [data, userLocation]);

  if (data.length === 0 && !userLocation) {
    return (
      <div className="w-full h-full min-h-[400px] bg-slate-100/50 dark:bg-zinc-900/50 rounded-xl border border-slate-200 dark:border-zinc-800 flex items-center justify-center text-slate-500 dark:text-slate-400 font-mono text-sm">
        NO DATA COLLECTED
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[400px] bg-slate-100/50 dark:bg-zinc-900/50 rounded-xl border border-slate-200 dark:border-zinc-800 relative overflow-hidden z-0">
      <MapContainer 
        center={center} 
        zoom={15} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        className="z-0"
      >
        <TileLayer
          attribution={theme === 'light' 
            ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            : '&copy; <a href="https://carto.com/attributions">CARTO</a>'}
          url={theme === 'light'
            ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"}
        />
        <MapUpdater center={center} />
        {data.map((d, i) => (
          <Circle
            key={d.id || i}
            center={[d.lat, d.lng]}
            radius={30}
            pathOptions={{
              fillColor: getNoiseColor(d.db),
              color: getNoiseColor(d.db),
              fillOpacity: 0.5,
              weight: 1,
              stroke: true
            }}
            eventHandlers={{
              click: () => setSelectedPoint(d)
            }}
          >
            <Popup className="dark:bg-zinc-950">
              <div className="font-mono text-[10px] dark:text-slate-200">
                <div className="font-bold text-slate-900 dark:text-white mb-1 text-lg">{d.db} dB</div>
                <div className="text-orange-500 uppercase tracking-widest font-bold">{d.category || 'Other'}</div>
                <div className="text-slate-500 dark:text-slate-400 mt-1">{new Date(d.timestamp).toLocaleString()}</div>
              </div>
            </Popup>
          </Circle>
        ))}
      </MapContainer>

      {/* Theme Toggle Button - Heatmap Section Only */}
      <div className="absolute top-4 left-4 z-[1000]">
        <button 
          onClick={toggleTheme}
          className="p-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all group"
          title={theme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {theme === 'light' ? (
            <Moon className="w-5 h-5 text-slate-600 group-hover:text-slate-900" />
          ) : (
            <Sun className="w-5 h-5 text-orange-500 group-hover:text-orange-400" />
          )}
        </button>
      </div>
      
      {/* Detail Overlay */}
      <AnimatePresence>
        {selectedPoint && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="absolute top-4 right-4 w-64 bg-white/95 dark:bg-zinc-950/95 border border-orange-500/30 rounded-xl p-4 shadow-2xl backdrop-blur-md z-[1000]"
          >
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-zinc-800 pb-2">
              <span className="text-[10px] font-mono text-orange-500 uppercase tracking-widest">Measurement Detail</span>
              <button onClick={() => setSelectedPoint(null)} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Noise Level</div>
                <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white">{selectedPoint.db} dB</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Category</div>
                <div className="text-xs font-mono text-orange-500 uppercase tracking-widest">{selectedPoint.category || 'Other'}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Latitude</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300">{selectedPoint.lat.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Longitude</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300">{selectedPoint.lng.toFixed(6)}</div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Timestamp</div>
                <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                  {new Date(selectedPoint.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Zoom Hint */}
      <div className="absolute bottom-4 right-4 text-[8px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest pointer-events-none z-[1000]">
        Scroll to zoom • Drag to pan • Click point for details
      </div>
    </div>
  );
};

const NoiseMapper = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [localUserId, setLocalUserId] = useState<string>('');
  const [measurements, setMeasurements] = useState<NoiseMeasurement[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentDb, setCurrentDb] = useState(0);
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(new Uint8Array(0));
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('House');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const categories = ['House', 'Market', 'Park', 'Road', 'Residential Apartment', 'Office', 'Other'];

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- Theme Management ---
  useEffect(() => {
    if (theme === 'dark') {
      window.document.documentElement.classList.add('dark');
    } else {
      window.document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // --- Local User ID & Data ---
  useEffect(() => {
    let id = localStorage.getItem('noise_mapper_uid');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('noise_mapper_uid', id);
    }
    setLocalUserId(id);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'noise_measurements'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NoiseMeasurement));
      setMeasurements(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'noise_measurements');
    });

    return () => unsubscribe();
  }, []);

  // --- Geolocation ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
        },
        (err) => console.error("Geolocation error:", err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // --- Audio Recording ---
  const startRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError("Microphone access is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsRecording(true);
      updateNoiseLevel();
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError("Microphone access was denied. Please check your browser and system settings to allow microphone access for this site.");
      } else {
        setMicError(`Microphone error: ${err.message || 'Unknown error'}`);
      }
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    setCurrentDb(0);
  };

  const updateNoiseLevel = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    setFrequencyData(new Uint8Array(dataArray));

    const sum = dataArray.reduce((acc, val) => acc + val, 0);
    const average = sum / dataArray.length;
    
    // Simple conversion to dB (approximate)
    const db = average > 0 ? 20 * Math.log10(average) + 30 : 0;
    setCurrentDb(db);

    animationFrameRef.current = requestAnimationFrame(updateNoiseLevel);
  };

  const saveMeasurement = async () => {
    if (!location || currentDb < 30) return;

    try {
      setIsUploading(true);
      await addDoc(collection(db, 'noise_measurements'), {
        uid: localUserId,
        db: Math.round(currentDb * 10) / 10,
        lat: location.lat,
        lng: location.lng,
        category: selectedCategory,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'noise_measurements');
    } finally {
      setIsUploading(false);
    }
  };

  // --- CSV Handling ---
  const downloadCSV = () => {
    const dataToExport = measurements.map((m) => {
      const dateObj = m.timestamp && (m.timestamp as any).seconds 
        ? new Date((m.timestamp as any).seconds * 1000) 
        : new Date(m.timestamp);
      
      return {
        'Latitude': m.lat,
        'Longitude': m.lng,
        'Sound Level': m.db,
        'Category': m.category || 'Other',
        'Date': dateObj.toLocaleDateString(),
        'Time': dateObj.toLocaleTimeString()
      };
    });
    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `noise_data_${new Date().toISOString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (!location) return;
    
    const file = acceptedFiles[0];
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (results) => {
        setIsUploading(true);
        try {
          for (const row of results.data as any[]) {
            const dbVal = row['Sound Level'] || row.db;
            const latVal = row['Latitude'] || row.lat;
            const lngVal = row['Longitude'] || row.lng;
            const categoryVal = row['Category'] || row.category || 'Other';
            const dateVal = row['Date'];
            const timeVal = row['Time'];
            
            let timestampVal = row.timestamp || new Date().toISOString();
            if (dateVal && timeVal) {
              const combined = new Date(`${dateVal} ${timeVal}`);
              if (!isNaN(combined.getTime())) {
                timestampVal = combined.toISOString();
              }
            }

            if (dbVal && latVal && lngVal) {
              await addDoc(collection(db, 'noise_measurements'), {
                uid: localUserId,
                db: dbVal,
                lat: latVal,
                lng: lngVal,
                category: categoryVal,
                timestamp: timestampVal
              });
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'noise_measurements');
        } finally {
          setIsUploading(false);
        }
      }
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false
  } as any);

  const deleteMeasurement = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'noise_measurements', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `noise_measurements/${id}`);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteStatus('idle');

    try {
      // 1. Delete all noise measurements
      const q = query(collection(db, 'noise_measurements'), where('uid', '==', localUserId));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setIsDeleting(false);
        setIsDeleteConfirmOpen(false);
        return;
      }

      const batch = writeBatch(db);
      querySnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      
      setDeleteStatus('success');
      setTimeout(() => {
        setIsDeleteConfirmOpen(false);
        setDeleteStatus('idle');
      }, 2000);
    } catch (error: any) {
      console.error("Error deleting data:", error);
      setDeleteStatus('error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 font-sans selection:bg-orange-500/30 relative overflow-x-hidden">
      <div className="atmosphere">
        <Leaf className="nature-element float-1 top-[10%] left-[5%] w-12 h-12" />
        <Bird className="nature-element float-2 top-[25%] right-[10%] w-8 h-8" />
        <Trees className="nature-element float-3 bottom-[15%] left-[10%] w-16 h-16" />
        <Flower className="nature-element float-1 bottom-[20%] right-[15%] w-10 h-10" />
        <Leaf className="nature-element float-2 top-[60%] left-[20%] w-6 h-6" />
        <Bird className="nature-element float-3 top-[40%] left-[80%] w-10 h-10" />
      </div>
      
      {/* Header */}
      <header className="glass-panel sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-orange-500" />
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-lg uppercase leading-none dark:text-white">Noise Mapper</span>
              <span className="text-[10px] text-slate-500 dark:text-white font-mono uppercase tracking-widest mt-1">App created by Aritra Pal</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsProfileOpen(true)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Local Settings Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProfileOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserCircle className="w-5 h-5 text-orange-500" />
                  <h2 className="font-bold uppercase tracking-widest text-sm text-slate-900 dark:text-slate-100">Local Settings</h2>
                </div>
                <button 
                  onClick={() => setIsProfileOpen(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {/* User Info */}
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-zinc-900/50 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <UserCircle className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Local Operator</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      ID: {localUserId.slice(0, 8)}...
                    </div>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-slate-100 dark:border-zinc-800">
                  <div className="mb-4">
                    <h3 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Danger Zone</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Permanently delete all noise data recorded from this device.</p>
                  </div>
                  <button 
                    onClick={() => {
                      setIsProfileOpen(false);
                      setIsDeleteConfirmOpen(true);
                    }}
                    className="w-full py-3 border border-red-500/30 hover:bg-red-500/10 text-red-500 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear Local Data
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        {/* Left Column: Controls & Real-time */}
        <div className="lg:col-span-4 space-y-6">
          {/* Recording Widget */}
          <div className="glass-card p-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative z-10">
              <div className="mb-6">
              <h3 className="text-[10px] font-mono text-orange-500 uppercase tracking-widest mb-2">Objective</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Map urban noise levels using phone-based measurements to identify pollution hotspots and inform urban planning.
              </p>
            </div>

            <div className="flex items-center justify-between mb-8 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Status</span>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full transition-colors duration-300", 
                    isRecording ? "bg-red-500 animate-pulse" : "bg-black dark:bg-white opacity-40"
                  )} />
                  <span className={cn(
                    "text-sm font-mono uppercase tracking-wider transition-colors duration-300",
                    isRecording ? "text-black dark:text-white" : "text-black dark:text-white opacity-40"
                  )}>
                    {isRecording ? "Capturing" : "Standby"}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Location</span>
                <div className="text-sm font-mono text-orange-500">
                  {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "Acquiring..."}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center py-10">
              <div className="relative mb-6">
                <div className={cn(
                  "absolute inset-0 rounded-full bg-orange-500/20 blur-2xl transition-all duration-500",
                  isRecording ? "scale-150 opacity-100" : "scale-0 opacity-0"
                )} />
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={cn(
                    "relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl",
                    isRecording 
                      ? "bg-red-500 hover:bg-red-600 scale-110" 
                      : "bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 hover:border-orange-500/50"
                  )}
                >
                  {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-orange-500" />}
                </button>
              </div>
              
              <AnimatePresence>
                {micError && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg flex items-center gap-2 text-[10px] font-mono text-red-500 uppercase tracking-widest max-w-xs text-center"
                  >
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    <span>{micError}</span>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="text-center">
                <div className={cn(
                  "text-6xl font-mono font-bold tracking-tighter mb-1 transition-colors duration-300",
                  isRecording 
                    ? "!text-black dark:!text-white" 
                    : "!text-black/40 dark:!text-white/40"
                )}>
                  {currentDb.toFixed(1)}
                </div>
                <div className={cn(
                  "text-[10px] font-mono uppercase tracking-widest transition-colors duration-300",
                  isRecording 
                    ? "!text-black/60 dark:!text-white/60" 
                    : "!text-black/40 dark:!text-white/40"
                )}>
                  Decibels (dB)
                </div>
                
                {/* Visual Meter Bar */}
                <div className={cn(
                  "mt-4 w-48 h-1 rounded-full overflow-hidden mx-auto transition-colors duration-300",
                  isRecording ? "bg-slate-100 dark:bg-slate-800" : "bg-slate-200/50 dark:bg-slate-800/50"
                )}>
                  <motion.div 
                    className="h-full transition-colors duration-300"
                    style={{ backgroundColor: getNoiseColor(currentDb) }}
                    animate={{ width: `${Math.min(100, (currentDb / 140) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Frequency Spectrum Section */}
            <div className={cn(
              "mt-6 pt-6 border-t transition-colors duration-300",
              isRecording ? "border-slate-100 dark:border-slate-800" : "border-slate-100/50 dark:border-slate-800/50"
            )}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest">Frequency Spectrum</h3>
                <span className="text-[10px] font-mono text-orange-500">20Hz - 20kHz</span>
              </div>
              <FrequencySpectrum data={frequencyData} />
            </div>

            {/* Category Selection */}
            <div className={cn(
              "mt-6 pt-6 border-t transition-colors duration-300 relative",
              isRecording ? "border-slate-100 dark:border-slate-800" : "border-slate-100/50 dark:border-slate-800/50"
            )}>
              <h3 className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Place Category</h3>
              <button
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className={cn(
                  "w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border rounded-xl flex items-center justify-between transition-all group",
                  isCategoryDropdownOpen ? "border-orange-500/50" : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                )}
              >
                <span className="text-xs font-mono uppercase tracking-widest text-slate-700 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                  {selectedCategory}
                </span>
                <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform duration-300", isCategoryDropdownOpen && "rotate-180")} />
              </button>

              <AnimatePresence>
                {isCategoryDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsCategoryDropdownOpen(false)} 
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute left-0 right-0 bottom-full mb-2 z-50 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
                    >
                      <div className="p-2 max-h-48 overflow-y-auto">
                        {categories.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => {
                              setSelectedCategory(cat);
                              setIsCategoryDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full px-4 py-2 rounded-lg text-left text-[10px] font-mono uppercase tracking-widest transition-all flex items-center justify-between",
                              selectedCategory === cat
                                ? "bg-orange-500/10 text-orange-500"
                                : "text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-slate-200"
                            )}
                          >
                            {cat}
                            {selectedCategory === cat && <Check className="w-3 h-3" />}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button 
              disabled={!isRecording || !location || isUploading}
              onClick={saveMeasurement}
              className={cn(
                "w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all mt-6",
                isRecording && location && !isUploading
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed"
              )}
            >
              {isUploading ? "Transmitting..." : "Log Measurement"}
            </button>
          </div>
        </div>
      </div>

        {/* Right Column: Visualization & History */}
        <div className="lg:col-span-8 space-y-6">
          {/* Heatmap */}
          <div className="glass-card p-6 h-[500px] flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-orange-500" />
                <h2 className="font-bold uppercase tracking-widest text-sm text-slate-900 dark:text-slate-100">Noise Heatmap</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getNoiseColor(0) }} />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">0dB</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getNoiseColor(140) }} />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">140dB</span>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <NoiseHeatmap 
                data={measurements} 
                userLocation={location} 
                theme={theme} 
                toggleTheme={toggleTheme} 
              />
            </div>
          </div>

          {/* Recent Logs */}
          <div className="glass-card overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-4">
                <h2 className="font-bold uppercase tracking-widest text-sm text-slate-900 dark:text-slate-100">Global Noise Logs</h2>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  {measurements.length} Total Records
                </span>
              </div>
              <button 
                onClick={() => setIsDeleteConfirmOpen(true)}
                className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2 border border-red-500/20"
              >
                <Trash2 className="w-3 h-3" />
                Clear All My Logs
              </button>
            </div>
            <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 dark:bg-zinc-950 z-20 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest shadow-sm">
                  <tr>
                    <th className="p-4 font-normal">Time</th>
                    <th className="p-4 font-normal">Source</th>
                    <th className="p-4 font-normal">Level</th>
                    <th className="p-4 font-normal">Category</th>
                    <th className="p-4 font-normal">Quality</th>
                    <th className="p-4 font-normal">Coordinates</th>
                    <th className="p-4 font-normal text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  <AnimatePresence mode="popLayout">
                    {measurements.map((m) => {
                      const date = m.timestamp && (m.timestamp as any).seconds 
                        ? new Date((m.timestamp as any).seconds * 1000) 
                        : new Date(m.timestamp);
                      const isOwner = m.uid === localUserId;
                      
                      return (
                        <motion.tr 
                          key={m.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, x: -20 }}
                          className={cn(
                            "hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors group",
                            isOwner && "bg-orange-500/[0.05] dark:bg-orange-500/[0.02]"
                          )}
                        >
                          <td className="p-4 text-xs text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                            {isNaN(date.getTime()) ? '---' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                isOwner ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" : "bg-slate-300 dark:bg-slate-700"
                              )} title={isOwner ? "Your Recording" : "Community Recording"} />
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">
                                {isOwner ? "You" : `ID:${m.uid?.slice(0, 4)}`}
                              </span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-16 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                                <div 
                                  className="h-full transition-all duration-500" 
                                  style={{ 
                                    width: `${Math.min(100, ((m.db || 0) / 140) * 100)}%`,
                                    backgroundColor: getNoiseColor(m.db || 0)
                                  }}
                                />
                              </div>
                              <span className="text-sm font-mono font-bold whitespace-nowrap text-slate-900 dark:text-slate-100">{(m.db || 0).toFixed(1)} dB</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
                              {m.category || 'Other'}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={cn(
                              "text-[9px] font-mono px-2 py-0.5 rounded-full uppercase tracking-widest whitespace-nowrap",
                              (m.db || 0) > 120 ? "bg-purple-500/20 text-purple-400 border border-purple-500/20" : 
                              (m.db || 0) > 80 ? "bg-red-500/20 text-red-400 border border-red-500/20" : 
                              (m.db || 0) > 60 ? "bg-amber-500/20 text-amber-400 border border-amber-500/20" :
                              "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {getNoiseQuality(m.db || 0)}
                            </span>
                          </td>
                          <td className="p-4 text-[10px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                            {m.lat?.toFixed(4)}, {m.lng?.toFixed(4)}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-slate-600 hover:text-orange-500 transition-colors flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest"
                                title="Display in Google Maps"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </a>
                              {isOwner && (
                                <button 
                                  onClick={() => m.id && deleteMeasurement(m.id)}
                                  className="p-2 text-slate-600 hover:text-red-500 transition-colors"
                                  title="Delete Log"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
              {measurements.length === 0 && (
                <div className="p-20 text-center flex flex-col items-center justify-center gap-3">
                  <Activity className="w-8 h-8 text-slate-300 dark:text-slate-700 animate-pulse" />
                  <div className="text-slate-500 dark:text-slate-400 font-mono text-xs uppercase tracking-widest">
                    Waiting for sensor data...
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Data Management */}
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-xs font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Data Management</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button 
                onClick={downloadCSV}
                className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors group border border-slate-100 dark:border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-blue-500" />
                  <div className="text-left">
                    <span className="text-sm font-medium block text-slate-900 dark:text-slate-100">Download My Data</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Save your records to your device</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-600">.csv</span>
              </button>

              <div {...getRootProps()} className={cn(
                "p-4 border-2 border-dashed rounded-xl transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-2",
                isDragActive ? "border-orange-500 bg-orange-500/5" : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
              )}>
                <input {...getInputProps()} />
                <Upload className="w-5 h-5 text-orange-500" />
                <div className="text-center">
                  <span className="text-sm font-medium block text-slate-900 dark:text-slate-100">Upload Existing Data</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Load records from a file</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto p-6 border-t border-slate-100 dark:border-zinc-800 mt-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <span>System v1.0.5</span>
          <span>•</span>
          <span>Encrypted Transmission</span>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <a 
            href="https://forms.gle/iV5Qu5EFpuoFLtz67" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all flex items-center gap-2 font-sans font-bold text-xs normal-case tracking-normal shadow-lg shadow-orange-500/20"
          >
            <ClipboardList className="w-4 h-4" />
            Take Survey
          </a>
          
          <div className="flex items-center gap-2">
            <Info className="w-3 h-3" />
            <span>Data used for research</span>
          </div>
        </div>
      </footer>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteConfirmOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setIsDeleteConfirmOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Clear All Your Logs?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
                This will permanently delete all noise measurements recorded from this device. This action cannot be undone.
              </p>

              <div className="flex flex-col gap-3">
                <button 
                  disabled={isDeleting}
                  onClick={handleDeleteAccount}
                  className={cn(
                    "w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                    deleteStatus === 'success' ? "bg-emerald-500 text-white" : 
                    deleteStatus === 'error' ? "bg-red-600 text-white" :
                    "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                  )}
                >
                  {isDeleting ? (
                    <Activity className="w-4 h-4 animate-spin" />
                  ) : deleteStatus === 'success' ? (
                    <>
                      <Check className="w-4 h-4" />
                      Deleted Successfully
                    </>
                  ) : deleteStatus === 'error' ? (
                    "Error Deleting"
                  ) : (
                    "Yes, Delete Everything"
                  )}
                </button>
                
                <button 
                  disabled={isDeleting}
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="w-full py-3 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <NoiseMapper />
    </ErrorBoundary>
  );
}
