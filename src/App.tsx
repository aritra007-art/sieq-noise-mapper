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
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  Mic, 
  MicOff, 
  Map as MapIcon, 
  Upload, 
  Download, 
  Trash2, 
  LogOut, 
  LogIn, 
  Activity,
  AlertCircle,
  Info,
  User as UserIcon,
  Settings,
  X,
  Mail,
  UserCircle
} from 'lucide-react';
import * as d3 from 'd3';
import Papa from 'papaparse';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';

import { db, auth, signIn, logOut, updateProfile, deleteUser } from './firebase';
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
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
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
        <div className="min-h-screen flex items-center justify-center bg-[#151619] text-white p-6">
          <div className="max-w-md w-full bg-[#1c1d21] border border-red-500/30 rounded-xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">System Error</h2>
            <p className="text-gray-400 mb-6">{errorMessage}</p>
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
      .attr('fill', d => d3.interpolateTurbo(d / 255));

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
        .attr('fill', '#4b5563')
        .attr('font-size', '8px')
        .attr('font-family', 'monospace')
        .text(d => d.text);
    }
  }, [data]);

  return (
    <div className="w-full h-32 bg-black/20 rounded-xl overflow-hidden border border-white/5">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};

const NoiseHeatmap = ({ data }: { data: NoiseMeasurement[] }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedPoint, setSelectedPoint] = useState<NoiseMeasurement | null>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const margin = { top: 20, right: 20, bottom: 40, left: 40 };

    // Normalize coordinates for visualization
    const xExtent = d3.extent(data, d => d.lng) as [number, number];
    const yExtent = d3.extent(data, d => d.lat) as [number, number];

    const xScale = d3.scaleLinear()
      .domain([xExtent[0] - 0.001, xExtent[1] + 0.001])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - 0.001, yExtent[1] + 0.001])
      .range([height - margin.bottom, margin.top]);

    const colorScale = (db: number) => getNoiseColor(db);

    // Create a container for zoomable content
    const g = svg.append("g");

    // Draw grid lines (static)
    const gridX = svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(xScale).ticks(5).tickSize(-height + margin.top + margin.bottom).tickFormat(() => ""))
      .attr("stroke-opacity", 0.1)
      .attr("stroke-dasharray", "2,2");

    const gridY = svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-width + margin.left + margin.right).tickFormat(() => ""))
      .attr("stroke-opacity", 0.1)
      .attr("stroke-dasharray", "2,2");

    // Draw points into the zoomable group
    const circles = g.selectAll("circle")
      .data(data)
      .enter()
      .append("circle")
      .attr("cx", d => xScale(d.lng))
      .attr("cy", d => yScale(d.lat))
      .attr("r", 8)
      .attr("fill", d => colorScale(d.db))
      .attr("opacity", 0.8)
      .attr("filter", "blur(2px)")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedPoint(d);
      });

    const dots = g.selectAll(".dot")
      .data(data)
      .enter()
      .append("circle")
      .attr("class", "dot")
      .attr("cx", d => xScale(d.lng))
      .attr("cy", d => yScale(d.lat))
      .attr("r", 3)
      .attr("fill", "#fff")
      .attr("opacity", 0.9)
      .attr("pointer-events", "none");

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .on("zoom", (event) => {
        const { transform } = event;
        g.attr("transform", transform);
        
        // Rescale axes if needed, but for a simple heatmap we can just transform the group
        // To keep circles same size during zoom:
        circles.attr("r", 8 / transform.k);
        dots.attr("r", 3 / transform.k);
      });

    svg.call(zoom);

    // Click on background to deselect
    svg.on("click", () => setSelectedPoint(null));

    // Add axes labels (static)
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 5)
      .attr("text-anchor", "middle")
      .attr("fill", "#8E9299")
      .attr("font-size", "10px")
      .attr("font-family", "monospace")
      .text("LONGITUDE");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#8E9299")
      .attr("font-size", "10px")
      .attr("font-family", "monospace")
      .text("LATITUDE");

  }, [data]);

  return (
    <div className="w-full h-full min-h-[400px] bg-black/40 rounded-xl border border-white/5 relative overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      
      {/* Detail Overlay */}
      <AnimatePresence>
        {selectedPoint && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="absolute top-4 right-4 w-64 bg-[#1c1d21] border border-orange-500/30 rounded-xl p-4 shadow-2xl backdrop-blur-md z-10"
          >
            <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
              <span className="text-[10px] font-mono text-orange-500 uppercase tracking-widest">Measurement Detail</span>
              <button onClick={() => setSelectedPoint(null)} className="text-gray-500 hover:text-white">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Noise Level</div>
                <div className="text-2xl font-mono font-bold text-white">{selectedPoint.db} dB</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Latitude</div>
                  <div className="text-xs font-mono text-gray-300">{selectedPoint.lat.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Longitude</div>
                  <div className="text-xs font-mono text-gray-300">{selectedPoint.lng.toFixed(6)}</div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Timestamp</div>
                <div className="text-xs font-mono text-gray-300">
                  {new Date(selectedPoint.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-mono text-sm">
          NO DATA COLLECTED
        </div>
      )}
      
      {/* Zoom Hint */}
      <div className="absolute bottom-4 right-4 text-[8px] font-mono text-gray-600 uppercase tracking-widest pointer-events-none">
        Scroll to zoom • Drag to pan • Click point for details
      </div>
    </div>
  );
};

const NoiseMapper = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [measurements, setMeasurements] = useState<NoiseMeasurement[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentDb, setCurrentDb] = useState(0);
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(new Uint8Array(0));
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- Auth & Data ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setNewDisplayName(u.displayName || '');
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setMeasurements([]);
      return;
    }

    const q = query(collection(db, 'noise_measurements'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NoiseMeasurement));
      setMeasurements(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'noise_measurements');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

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
    } catch (err) {
      console.error("Microphone access denied:", err);
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
    if (!user || !location || currentDb < 30) return;

    try {
      setIsUploading(true);
      await addDoc(collection(db, 'noise_measurements'), {
        uid: user.uid,
        db: Math.round(currentDb * 10) / 10,
        lat: location.lat,
        lng: location.lng,
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
    const csv = Papa.unparse(measurements.map(({ id, uid, ...rest }) => rest));
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
    if (!user || !location) return;
    
    const file = acceptedFiles[0];
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (results) => {
        setIsUploading(true);
        try {
          for (const row of results.data as any[]) {
            if (row.db && row.lat && row.lng) {
              await addDoc(collection(db, 'noise_measurements'), {
                uid: user.uid,
                db: row.db,
                lat: row.lat,
                lng: row.lng,
                timestamp: row.timestamp || new Date().toISOString()
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

  const handleUpdateProfile = async () => {
    if (!user || !newDisplayName.trim()) return;
    setIsUpdatingProfile(true);
    try {
      await updateProfile(user, { displayName: newDisplayName });
      setUser({ ...user, displayName: newDisplayName } as User);
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmDelete = window.confirm(
      "Are you absolutely sure? This will permanently delete your account and ALL your noise measurements. This action cannot be undone."
    );
    if (!confirmDelete) return;

    setIsUpdatingProfile(true);
    try {
      // 1. Delete all noise measurements
      const q = query(collection(db, 'noise_measurements'), where('uid', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);
      querySnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // 2. Delete the user document if it exists
      await deleteDoc(doc(db, 'users', user.uid));

      // 3. Delete the auth account
      await deleteUser(user);
      
      alert("Account and data deleted successfully.");
      window.location.reload();
    } catch (error: any) {
      console.error("Error deleting account:", error);
      if (error.code === 'auth/requires-recent-login') {
        alert("This operation is sensitive and requires recent authentication. Please log out and log back in, then try again.");
      } else {
        alert("Failed to delete account. Please try again later.");
      }
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  if (!isAuthReady) return null;

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 font-sans relative overflow-hidden">
        <div className="atmosphere" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full glass-card p-12 text-center relative z-10"
        >
          <div className="w-20 h-20 bg-orange-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-12 group hover:rotate-0 transition-transform duration-500">
            <Activity className="w-10 h-10 text-orange-500" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tighter">Urban Noise Mapper</h1>
          <p className="text-[10px] text-orange-500 font-mono uppercase tracking-[0.2em] mb-8">App created by Aritra Pal</p>
          <p className="text-gray-400 mb-10 leading-relaxed text-sm">
            Join the mission to map urban noise pollution. Help us identify hotspots and create quieter, healthier cities through real-time data.
          </p>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-white text-black hover:bg-orange-500 hover:text-white font-bold rounded-xl transition-all flex items-center justify-center gap-3 shadow-xl group"
          >
            <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500/30 relative overflow-x-hidden">
      <div className="atmosphere" />
      
      {/* Header */}
      <header className="glass-panel sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-orange-500" />
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-lg uppercase leading-none">Noise Mapper</span>
              <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mt-1">App created by Aritra Pal</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsProfileOpen(true)}
              className="hidden sm:flex flex-col items-end hover:opacity-80 transition-opacity"
            >
              <span className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-widest mb-0.5">Operator</span>
              <span className="text-sm font-medium flex items-center gap-2">
                {user.displayName}
                <Settings className="w-3 h-3 text-orange-500" />
              </span>
            </button>
            <button 
              onClick={logOut}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Profile Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProfileOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#151619] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserCircle className="w-5 h-5 text-orange-500" />
                  <h2 className="font-bold uppercase tracking-widest text-sm">Account Settings</h2>
                </div>
                <button 
                  onClick={() => setIsProfileOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {/* User Info */}
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
                  <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <UserIcon className="w-6 h-6 text-orange-500" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{user.displayName}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {user.email}
                    </div>
                  </div>
                </div>

                {/* Edit Section */}
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2 block">Display Name</label>
                    <input 
                      type="text" 
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-colors"
                      placeholder="Enter display name"
                    />
                  </div>
                  <button 
                    onClick={handleUpdateProfile}
                    disabled={isUpdatingProfile || newDisplayName === user.displayName}
                    className="w-full py-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold transition-all"
                  >
                    {isUpdatingProfile ? "Updating..." : "Save Changes"}
                  </button>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-white/5">
                  <div className="mb-4">
                    <h3 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Danger Zone</h3>
                    <p className="text-[10px] text-gray-500">Permanently delete your account and all associated noise data.</p>
                  </div>
                  <button 
                    onClick={handleDeleteAccount}
                    className="w-full py-3 border border-red-500/30 hover:bg-red-500/10 text-red-500 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Account
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
              <p className="text-xs text-gray-400 leading-relaxed">
                Map urban noise levels using phone-based measurements to identify pollution hotspots and inform urban planning.
              </p>
            </div>

            <div className="flex items-center justify-between mb-8 border-t border-white/5 pt-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Status</span>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", isRecording ? "bg-red-500 animate-pulse" : "bg-gray-600")} />
                  <span className="text-sm font-mono uppercase tracking-wider">
                    {isRecording ? "Capturing" : "Standby"}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Location</span>
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
                      : "bg-[#1c1d21] border border-white/10 hover:border-orange-500/50"
                  )}
                >
                  {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8 text-orange-500" />}
                </button>
              </div>
              
              <div className="text-center">
                <div className="text-6xl font-mono font-bold tracking-tighter mb-1">
                  {currentDb.toFixed(1)}
                </div>
                <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Decibels (dB)</div>
                
                {/* Visual Meter Bar */}
                <div className="mt-4 w-48 h-1 bg-white/5 rounded-full overflow-hidden mx-auto">
                  <motion.div 
                    className="h-full transition-colors duration-300"
                    style={{ backgroundColor: getNoiseColor(currentDb) }}
                    animate={{ width: `${Math.min(100, (currentDb / 140) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Frequency Spectrum Section */}
            <div className="mt-6 pt-6 border-t border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Frequency Spectrum</h3>
                <span className="text-[10px] font-mono text-orange-500">20Hz - 20kHz</span>
              </div>
              <FrequencySpectrum data={frequencyData} />
            </div>

            <button 
              disabled={!isRecording || !location || isUploading}
              onClick={saveMeasurement}
              className={cn(
                "w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all mt-6",
                isRecording && location && !isUploading
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20"
                  : "bg-white/5 text-gray-600 cursor-not-allowed"
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
                <h2 className="font-bold uppercase tracking-widest text-sm">Noise Heatmap</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getNoiseColor(0) }} />
                  <span className="text-[10px] font-mono text-gray-500">0dB</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getNoiseColor(140) }} />
                  <span className="text-[10px] font-mono text-gray-500">140dB</span>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <NoiseHeatmap data={measurements} />
            </div>
          </div>

          {/* Recent Logs */}
          <div className="glass-card overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h2 className="font-bold uppercase tracking-widest text-sm">My Recent Logs</h2>
              <span className="text-[10px] font-mono text-gray-500">
                {measurements.filter(m => m.uid === user.uid).length} Records
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#1c1d21] text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                  <tr>
                    <th className="p-4 font-normal">Time</th>
                    <th className="p-4 font-normal">Level</th>
                    <th className="p-4 font-normal">Quality</th>
                    <th className="p-4 font-normal">Coordinates</th>
                    <th className="p-4 font-normal text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <AnimatePresence mode="popLayout">
                    {measurements.filter(m => m.uid === user.uid).map((m) => (
                      <motion.tr 
                        key={m.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="hover:bg-white/[0.02] transition-colors group"
                      >
                        <td className="p-4 text-xs text-gray-400 font-mono">
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className="h-full" 
                                style={{ 
                                  width: `${Math.min(100, (m.db / 140) * 100)}%`,
                                  backgroundColor: getNoiseColor(m.db)
                                }}
                              />
                            </div>
                            <span className="text-sm font-mono font-bold">{m.db} dB</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-widest",
                            m.db > 120 ? "bg-purple-500/20 text-purple-400" : 
                            m.db > 80 ? "bg-red-500/20 text-red-400" : 
                            m.db > 60 ? "bg-amber-500/20 text-amber-400" :
                            "bg-emerald-500/20 text-emerald-400"
                          )}>
                            {getNoiseQuality(m.db)}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-gray-500 font-mono">
                          {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => m.id && deleteMeasurement(m.id)}
                            className="p-2 text-gray-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {measurements.filter(m => m.uid === user.uid).length === 0 && (
                <div className="p-10 text-center text-gray-500 font-mono text-sm">
                  NO PERSONAL RECORDS FOUND
                </div>
              )}
            </div>
          </div>

          {/* Data Management */}
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4">Data Management</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button 
                onClick={downloadCSV}
                className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group border border-white/5"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-blue-400" />
                  <div className="text-left">
                    <span className="text-sm font-medium block">Download My Data</span>
                    <span className="text-[10px] text-gray-500">Save your records to your device</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-300">.csv</span>
              </button>

              <div {...getRootProps()} className={cn(
                "p-4 border-2 border-dashed rounded-xl transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-2",
                isDragActive ? "border-orange-500 bg-orange-500/5" : "border-white/10 hover:border-white/20"
              )}>
                <input {...getInputProps()} />
                <Upload className="w-5 h-5 text-orange-500" />
                <div className="text-center">
                  <span className="text-sm font-medium block">Upload Existing Data</span>
                  <span className="text-[10px] text-gray-500">Load records from a file</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto p-6 border-t border-white/5 mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] font-mono text-gray-600 uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <span>System v1.0.4</span>
          <span>•</span>
          <span>Encrypted Transmission</span>
        </div>
        <div className="flex items-center gap-2">
          <Info className="w-3 h-3" />
          <span>Data used for urban planning research</span>
        </div>
      </footer>
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
