/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vite/client" />

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  Send, 
  Image as ImageIcon, 
  X, 
  Volume2, 
  VolumeX,
  Loader2,
  BookOpen,
  MessageCircle,
  Camera
} from 'lucide-react';
import { cn } from './lib/utils';
import { getLinusResponse, getPronunciationFeedback, ChatMessage } from './services/geminiService';
import Markdown from 'react-markdown';

import Vapi from '@vapi-ai/web';

const vapi = new Vapi(import.meta.env.VITE_VAPI_PUBLIC_KEY || "02a3fa72-a301-4d50-97e8-868b601ab48d");

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: "Hello! Main Khan Sir's AI Academy Trainer hoon, aapki personal English trainer. Hum basic se lekar advanced level tak English seekhenge. Shuru karne se pehle, aap apni English ko kahan rate karenge? Beginner, Thodi bohot aati hai, ya samajh aati hai par bolne mein dikkat hoti hai?" }
  ]);
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [callStatus, setCallStatus] = useState<'inactive' | 'loading' | 'active'>('inactive');
  const [practicingWord, setPracticingWord] = useState<string | null>(null);
  const [isPracticing, setIsPracticing] = useState(false);
  const [feedback, setFeedback] = useState<{ [key: string]: string }>({});
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    vapi.on('call-start', () => {
      setCallStatus('active');
      setIsRecording(true);
    });

    vapi.on('call-end', () => {
      setCallStatus('inactive');
      setIsRecording(false);
    });

    vapi.on('speech-start', () => {
      setIsAudioPlaying(true);
    });

    vapi.on('speech-end', () => {
      setIsAudioPlaying(false);
    });

    vapi.on('message', (message) => {
      if (message.type === 'transcript' && message.transcriptType === 'final') {
        const role = message.role === 'user' ? 'user' : 'model';
        const text = message.transcript;
        
        setMessages(prev => {
          // Check if the last message is the same to avoid duplicates (sometimes Vapi sends multiple final transcripts)
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === role && lastMsg.text === text) {
            return prev;
          }
          return [...prev, { role, text }];
        });
      }
    });

    vapi.on('error', (e) => {
      console.error('Vapi error:', e);
      setCallStatus('inactive');
      setIsRecording(false);
    });

    return () => {
      vapi.stop();
    };
  }, []);

  const toggleCall = async () => {
    if (callStatus === 'active') {
      vapi.stop();
    } else {
      setCallStatus('loading');
      try {
        await vapi.start(import.meta.env.VITE_VAPI_AGENT_ID || "d8d2574d-7e8d-4787-9efd-ef0fe5ca76e3");
      } catch (err) {
        console.error('Failed to start Vapi call:', err);
        setCallStatus('inactive');
      }
    }
  };

  const playAudio = async (base64Audio: string) => {
    if (!isAudioEnabled || !base64Audio) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000);
      buffer.getChannelData(0).set(floatData);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        setIsAudioPlaying(false);
      };

      setIsAudioPlaying(true);
      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsAudioPlaying(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !selectedImage) return;

    const userMessage: ChatMessage = {
      role: 'user',
      text: input,
      image: selectedImage || undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSelectedImage(null);
    setIsTyping(true);

    try {
      const response = await getLinusResponse(userMessage.text, userMessage.image, messages);
      const modelMessage: ChatMessage = {
        role: 'model',
        text: response.text,
        audio: response.audio,
        vocabulary: response.vocabulary
      };
      setMessages(prev => [...prev, modelMessage]);
      if (response.audio) {
        playAudio(response.audio);
      }
    } catch (error) {
      console.error("Linus Error:", error);
      setMessages(prev => [...prev, { role: 'model', text: "I'm sorry, I'm having a bit of trouble right now. Could you try again?" }]);
    } finally {
      setIsTyping(false);
    }
  };

  const startPractice = async (word: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          const vocab = messages.flatMap(m => m.vocabulary || []).find(v => v.word === word);
          if (vocab) {
            setIsPracticing(true);
            try {
              const result = await getPronunciationFeedback(vocab.word, vocab.phonetic, base64Audio);
              setFeedback(prev => ({ ...prev, [word]: result }));
            } catch (err) {
              console.error("Feedback error:", err);
            } finally {
              setIsPracticing(false);
            }
          }
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setPracticingWord(word);
    } catch (err) {
      console.error("Microphone access error:", err);
    }
  };

  const stopPractice = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setPracticingWord(null);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm overflow-hidden border border-blue-100">
            <img 
              src="https://storage.googleapis.com/a1aa/image/Vv_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u_v_u.jpg" 
              alt="Logo" 
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/khan-logo/100/100';
              }}
            />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-slate-800">AI Academy</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsAudioEnabled(!isAudioEnabled)}
            className={cn(
              "p-2.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-95",
              isAudioEnabled ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"
            )}
            title={isAudioEnabled ? "Mute Linus" : "Unmute Linus"}
          >
            {isAudioEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>
      </header>

      {/* Main Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
      >
        <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                "flex w-full",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn(
                "max-w-[85%] md:max-w-[70%] rounded-2xl p-4 shadow-sm",
                msg.role === 'user' 
                  ? "bg-blue-600 text-white rounded-tr-none" 
                  : "bg-white border border-slate-200 text-slate-800 rounded-tl-none"
              )}>
                {msg.image && (
                  <div className="mb-3 rounded-lg overflow-hidden border border-slate-100/20">
                    <img src={msg.image} alt="Uploaded" className="max-w-full h-auto" referrerPolicy="no-referrer" />
                  </div>
                )}
                <div className="prose prose-sm max-w-none prose-slate">
                  <Markdown components={{
                    p: ({children}) => <p className="m-0 leading-relaxed">{children}</p>
                  }}>
                    {msg.text}
                  </Markdown>
                </div>
                {msg.audio && msg.role === 'model' && (
                  <button 
                    onClick={() => playAudio(msg.audio!)}
                    className="mt-2 flex items-center gap-1.5 text-xs font-medium opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <Volume2 size={12} /> Replay Audio
                  </button>
                )}

                {msg.vocabulary && msg.vocabulary.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Vocabulary</p>
                    {msg.vocabulary.map((vocab, vIdx) => (
                      <div key={vIdx} className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 space-y-3">
                        <div className="flex items-start justify-between group">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-blue-600">{vocab.word}</span>
                              <span className="text-xs text-slate-400 font-mono">{vocab.phonetic}</span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">{vocab.meaning}</p>
                          </div>
                          <div className="flex gap-2">
                            {vocab.audio && (
                              <button 
                                onClick={() => playAudio(vocab.audio!)}
                                className="p-2 rounded-lg bg-white shadow-sm text-blue-600 hover:bg-blue-50 transition-colors"
                                title="Listen"
                              >
                                <Volume2 size={14} />
                              </button>
                            )}
                            <button 
                              onMouseDown={() => startPractice(vocab.word)}
                              onMouseUp={stopPractice}
                              onMouseLeave={stopPractice}
                              onTouchStart={() => startPractice(vocab.word)}
                              onTouchEnd={stopPractice}
                              className={cn(
                                "p-2 rounded-lg shadow-sm transition-all",
                                practicingWord === vocab.word ? "bg-red-500 text-white animate-pulse" : "bg-white text-slate-600 hover:bg-slate-50"
                              )}
                              title="Hold to practice pronunciation"
                            >
                              <Mic size={14} />
                            </button>
                          </div>
                        </div>
                        
                        {isPracticing && practicingWord === vocab.word && (
                          <div className="flex items-center gap-2 text-[10px] text-blue-500 animate-pulse">
                            <Loader2 size={10} className="animate-spin" />
                            Analyzing your pronunciation...
                          </div>
                        )}

                        {feedback[vocab.word] && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-blue-50 rounded-xl p-3 text-[11px] text-blue-800 border border-blue-200 shadow-sm relative overflow-hidden"
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
                            <div className="flex items-start gap-2">
                              <div className="mt-0.5 text-blue-600">
                                <MessageCircle size={12} />
                              </div>
                              <div>
                                <span className="font-bold block mb-1 text-blue-900">Expert Feedback:</span>
                                <p className="leading-relaxed italic">{feedback[vocab.word]}</p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isTyping && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
              <Loader2 className="animate-spin text-blue-600" size={18} />
              <span className="text-sm font-medium text-slate-500">Trainer is thinking...</span>
            </div>
          </motion.div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto space-y-3">
          {selectedImage && (
            <div className="relative inline-block">
              <img src={selectedImage} alt="Preview" className="h-20 w-20 object-cover rounded-lg border-2 border-blue-500 shadow-md" />
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg hover:bg-red-600 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              title="Upload from Gallery"
            >
              <ImageIcon size={22} />
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              className="p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              title="Open Camera"
            >
              <Camera size={22} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
            <input 
              type="file" 
              ref={cameraInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              capture="environment"
              className="hidden" 
            />
            
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask Trainer anything..."
                className="w-full p-3.5 pr-12 bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-blue-500 transition-all outline-none text-slate-800 placeholder:text-slate-400"
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() && !selectedImage}
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all",
                  (input.trim() || selectedImage) ? "bg-blue-600 text-white shadow-md hover:bg-blue-700" : "text-slate-400"
                )}
              >
                <Send size={18} />
              </button>
            </div>
            
            <button 
              className={cn(
                "p-3.5 rounded-xl transition-all duration-300",
                callStatus === 'active' ? "bg-red-500 text-white animate-pulse" : 
                callStatus === 'loading' ? "bg-slate-200 text-slate-400 cursor-not-allowed" :
                "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
              onClick={toggleCall}
              disabled={callStatus === 'loading'}
              title={callStatus === 'active' ? "End voice call" : "Start voice call"}
            >
              {callStatus === 'loading' ? <Loader2 size={22} className="animate-spin" /> : <Mic size={22} />}
            </button>
          </div>
          
          <div className="flex justify-center gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <div className="flex items-center gap-1.5">
              <BookOpen size={10} />
              <span>Learn English</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageCircle size={10} />
              <span>Real-time Chat</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
