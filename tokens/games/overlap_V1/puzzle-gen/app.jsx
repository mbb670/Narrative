import React, { useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { Plus, Trash2, ArrowRight, Link as LinkIcon, RefreshCw, GripVertical, AlertTriangle, Wand2, Hammer, X, Globe, AlertCircle, Sparkles, Layers, Type, CheckCircle2, ArrowUp, ArrowDown, Square, RotateCw, Percent, AlignLeft, ArrowLeft, Copy, Check, ChevronDown, ChevronUp, Undo, PenTool, ArrowLeftCircle, Book, Redo } from "https://esm.sh/lucide-react@0.468.0?dev&deps=react@18.3.1";
import { GEMINI_API_KEY as apiKey } from "./local-key.js";

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = "", disabled = false, size = 'normal', title = "" }) => {
  const baseStyle = "rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2";
  const sizes = {
    small: "px-3 py-1.5 text-sm",
    normal: "px-4 py-2",
  };
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
    danger: "text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100",
    warning: "bg-amber-100 text-amber-700 hover:bg-amber-200 border border-transparent"
  };
  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${sizes[size]} ${variants[variant]} ${className}`}
      title={title}
    >
      {children}
    </button>
  );
};

// --- Logic Helpers ---

const cleanWord = (w) => w.toLowerCase().replace(/[^a-z]/g, '');

const shuffleArray = (array) => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const getOverlap = (w1, w2, minLen = 2) => {
  const a = cleanWord(w1);
  const b = cleanWord(w2);
  const min = Math.min(a.length, b.length);
  
  for (let len = min; len >= minLen; len--) {
    if (a.endsWith(b.substring(0, len))) {
      return {
        overlapStr: b.substring(0, len),
        count: len
      };
    }
  }
  return null;
};

const isDerivative = (w1, w2) => {
    const c1 = cleanWord(w1);
    const c2 = cleanWord(w2);
    if (c1.includes(c2) || c2.includes(c1)) return true;
    if (c1.length > 4 && c2.length > 4) {
        let matchingChars = 0;
        while (matchingChars < c1.length && matchingChars < c2.length && c1[matchingChars] === c2[matchingChars]) {
            matchingChars++;
        }
        if (matchingChars >= 4) return true; 
    }
    return false;
};

// Clipboard Helper
const copyToClipboard = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Failed to copy text', err);
    }
    document.body.removeChild(textarea);
};

// --- Clue Generation Helpers ---

const cleanDefinition = (rawDef) => {
    if (!rawDef) return "";
    const parts = rawDef.split('\t');
    let def = parts.length > 1 ? parts[1] : parts[0];
    if (def.endsWith('.')) def = def.slice(0, -1);
    return def;
};

const generateGeminiClue = async (word, difficulty, definitionContext) => {
    const difficultyPrompts = {
        easy: "Write a direct, simple crossword clue (definition or synonym).",
        medium: "Write a standard crossword clue (witty or slightly lateral).",
        hard: "Write a difficult, abstract, or punny crossword clue."
    };

    const prompt = `Task: ${difficultyPrompts[difficulty]}
Answer Word: "${word}"
Context Definition: "${definitionContext}"
Constraints:
- Max 35 characters.
- NEVER include the answer word "${word}" or variations of it in the clue.
- Prefer phrases over single words.
- Return ONLY the clue text. Do not include labels like "Clue:" or "Silent thought:".`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        if (!response.ok) return null;

        const data = await response.json();
        let clue = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        
        if (clue) {
            clue = clue.replace(/^(Clue|Answer|Silent thought|Thought):/i, '').trim();
            clue = clue.split('\n')[0].trim();
            clue = clue.replace(/^["']|["']$/g, ''); 
            if (clue.endsWith('.')) clue = clue.slice(0, -1);
            return clue;
        }
    } catch (e) {
        console.warn("Gemini generation failed, falling back", e);
    }
    return null;
};

const fetchClueData = async (word, difficulty) => {
    let dictionaryDef = "No definition found.";
    let finalClue = "";

    try {
        const defRes = await fetch(`https://api.datamuse.com/words?sp=${word}&md=d&max=1`);
        const defData = await defRes.json();
        if (defData.length > 0 && defData[0].defs && defData[0].defs.length > 0) {
            dictionaryDef = cleanDefinition(defData[0].defs[0]);
        }
    } catch(e) { console.error(e); }

    const aiClue = await generateGeminiClue(word, difficulty, dictionaryDef);
    
    if (aiClue) {
        finalClue = aiClue;
    } else {
        try {
            const relRes = await fetch(`https://api.datamuse.com/words?ml=${word}&max=20`);
            const relData = await relRes.json();
            
            const badWord = cleanWord(word);
            const options = relData.filter(d => {
                const t = d.word.toLowerCase();
                if (t.includes(badWord) || badWord.includes(t)) return false;
                return true;
            });
            
            if (options.length > 0) {
                 finalClue = options[0].word; 
            } else {
                 finalClue = dictionaryDef.split(' ').slice(0, 5).join(' ') + "..."; 
            }
        } catch (e) {
            finalClue = "A mystery word";
        }
    }

    finalClue = finalClue.charAt(0).toUpperCase() + finalClue.slice(1);

    return { clue: finalClue, definition: dictionaryDef };
};


// --- Algorithms ---

const findBridges = (startWord, endWord, allUniqueWords) => {
  return allUniqueWords.filter(bridge => {
    if (bridge === startWord || bridge === endWord) return false;
    if (startWord[0].toLowerCase() === bridge[0].toLowerCase()) return false;
    if (bridge[0].toLowerCase() === endWord[0].toLowerCase()) return false;
    if (isDerivative(startWord, bridge) || isDerivative(bridge, endWord)) return false;

    const overlap1 = getOverlap(startWord, bridge);
    const overlap2 = getOverlap(bridge, endWord);
    
    return overlap1 && overlap2;
  });
};

// --- Core Processing Function ---
const processWordsToInventory = async (wordList, targetLength, targetTriplePct, setProgress, skipPathfinding = false) => {
  const uniqueWords = [...new Set(wordList)];
  let pairs = [];
  
  const chunkSize = 500;
  for (let i = 0; i < uniqueWords.length; i += chunkSize) {
      await new Promise(r => setTimeout(r, 0));
      const chunk = uniqueWords.slice(i, i + chunkSize);
      
      for (let w1 of chunk) {
          for (let w2 of uniqueWords) {
             if (w1 === w2) continue;
             if (w1[0].toLowerCase() === w2[0].toLowerCase()) continue;
             if (isDerivative(w1, w2)) continue; 

             const overlap = getOverlap(w1, w2);
             if (overlap) { 
                const ratio1 = overlap.count / w1.length;
                const ratio2 = overlap.count / w2.length;
                if (ratio1 > 0.75 || ratio2 > 0.75) continue; 

                pairs.push({
                  id: `pair-${w1}-${w2}`,
                  words: [w1, w2],
                  overlaps: [overlap],
                  totalOverlap: overlap.count,
                  startWord: w1,
                  endWord: w2,
                  type: 'pair'
                });
             }
          }
      }
  }

  let triples = [];
  const pairsByStart = {};
  pairs.forEach(p => {
      if(!pairsByStart[p.startWord]) pairsByStart[p.startWord] = [];
      pairsByStart[p.startWord].push(p);
  });

  for (let p1 of pairs) {
      const candidates = pairsByStart[p1.endWord] || [];
      for (let p2 of candidates) {
        if (p1.startWord !== p2.endWord) {
            const midWord = p1.endWord;
            const startOverlapEndIdx = p1.totalOverlap; 
            const endOverlapStartIdx = midWord.length - p2.totalOverlap;
            
            if (startOverlapEndIdx > endOverlapStartIdx) {
                if (!isDerivative(p1.startWord, p2.endWord)) {
                    triples.push({
                        id: `triple-${p1.startWord}-${p1.endWord}-${p2.endWord}`,
                        words: [p1.startWord, p1.endWord, p2.endWord],
                        overlaps: [p1.overlaps[0], p2.overlaps[0]],
                        totalOverlap: p1.totalOverlap + p2.totalOverlap,
                        startWord: p1.startWord,
                        endWord: p2.endWord,
                        type: 'triple'
                    });
                }
            }
        }
      }
  }

  const allItems = [...triples, ...pairs].sort((a, b) => {
     if (a.type !== b.type) return a.type === 'triple' ? -1 : 1;
     return b.totalOverlap - a.totalOverlap;
  });
  
  return { inventory: allItems, uniqueWords };
};

const filterBadWords = (words) => {
    const badAffixes = [
        'itis', 'osis', 'ectomy', 'pathy', 'plasty', 'ology', 'scopy', 'otomy', 'emia', 'rrhea', 
        'over', 'under', 'mid', 'out', 'self', 'super', 'inter', 'intra', 'non', 'pre', 're', 
        'counter', 'anti', 'semi', 'multi', 'poly', 'tide', 'fest', 'light', 'side', 'back', 'fore', 'head', 'less', 'ness', 'tion', 'sion', 'ment'
    ];
    
    return words.filter(w => {
        if (w.length < 4) return false; 
        if (!/^[a-zA-Z]+$/.test(w)) return false;
        if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) return false;

        const hasBadAffix = badAffixes.some(a => {
            if (w.startsWith(a) && w.length > a.length + 3) return true;
            if (w.endsWith(a) && w.length > a.length + 3) return true;
            return false;
        });

        return !hasBadAffix;
    });
};

// Pathfinder for Multi-Chain organization
const findLongestChainInInventory = (items, usedWordsGlobal = new Set()) => {
  if (items.length === 0) return [];

  const adj = {};
  items.forEach(item => {
    const s = cleanWord(item.startWord);
    if (!adj[s]) adj[s] = [];
    adj[s].push(item);
  });

  let bestPath = [];
  let maxScore = 0;
  
  const getScore = (path) => {
      return path.reduce((acc, item) => acc + (item.type === 'triple' ? 50 : item.totalOverlap), 0);
  };

  const dfs = (currentPath, currentUsedWords) => {
      if (currentPath.length > 15) return; 

      const currentScore = getScore(currentPath);
      if (currentScore > maxScore) {
          maxScore = currentScore;
          bestPath = [...currentPath];
      }

      const lastItem = currentPath[currentPath.length - 1];
      const nextStart = cleanWord(lastItem.endWord);
      
      let candidates = adj[nextStart] || [];
      candidates.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'triple' ? -1 : 1;
          return b.totalOverlap - a.totalOverlap;
      });

      candidates = candidates.slice(0, 10);

      for (const item of candidates) {
          const newWords = item.words.slice(1).map(w => cleanWord(w));
          const hasConflict = newWords.some(w => currentUsedWords.has(w));
          
          if (!hasConflict) {
              const nextUsed = new Set(currentUsedWords);
              newWords.forEach(w => nextUsed.add(w));
              dfs([...currentPath, item], nextUsed);
          }
      }
  };

  const sortedItems = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'triple' ? -1 : 1;
      return b.totalOverlap - a.totalOverlap;
  });

  const starters = sortedItems.slice(0, 50);

  for (const startItem of starters) {
      const itemWords = startItem.words.map(w => cleanWord(w));
      if (itemWords.some(w => usedWordsGlobal.has(w))) continue;

      const initialUsed = new Set(usedWordsGlobal);
      itemWords.forEach(w => initialUsed.add(w));
      
      dfs([startItem], initialUsed);
  }

  return bestPath;
};

const processInventoryToMultiChain = (allItems, limit) => {
    let pool = [...allItems];
    let finalSequence = [];
    let globalUsedWords = new Set();

    let loopCount = 0;
    while (pool.length > 0 && finalSequence.length < limit && loopCount < 20) {
        loopCount++;
        const chainSegment = findLongestChainInInventory(pool, globalUsedWords);
        
        if (chainSegment.length === 0) break;

        finalSequence = [...finalSequence, ...chainSegment];

        chainSegment.forEach(item => {
            item.words.forEach(w => globalUsedWords.add(cleanWord(w)));
        });

        pool = pool.filter(item => {
            return !item.words.some(w => globalUsedWords.has(cleanWord(w)));
        });
        
        if (finalSequence.length >= limit) break;
    }

    return finalSequence;
};

// --- Components ---

const InventoryItem = ({ item, onDragStart, isCompact = false }) => {
  const isTriple = item.words.length === 3;
  
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      className={`
        group relative cursor-grab active:cursor-grabbing 
        bg-white border hover:border-indigo-300 border-slate-200 
        rounded-lg transition-all duration-200 hover:shadow-md
        ${isCompact ? 'p-2 text-sm' : 'p-3'}
      `}
    >
      <div className="flex items-center gap-1 flex-wrap">
        <div className="flex items-center gap-0.5 font-medium text-slate-700">
          {item.words.map((word, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && (
                 <div className="flex items-center text-slate-300 mx-1">
                   <ArrowRight size={12} />
                 </div>
              )}
              <span className={idx === 1 ? "text-indigo-600 font-bold" : ""}>{word}</span>
            </React.Fragment>
          ))}
        </div>
        
        <div className="ml-auto flex gap-2">
          {isTriple && (
            <span className="text-[10px] uppercase tracking-wider font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">Triple</span>
          )}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${item.totalOverlap > 2 ? 'text-indigo-600 bg-indigo-50' : 'text-slate-500 bg-slate-100'}`}>
            <LinkIcon size={10} />
            {item.totalOverlap}
          </span>
        </div>
      </div>
      
      <div className="text-xs text-slate-400 mt-1 pl-1">
         Matches: <span className="font-mono text-indigo-400">{item.overlaps.map(o => o.overlapStr).join(', ')}</span>
      </div>
    </div>
  );
};

export default function App() {
  const [inputText, setInputText] = useState("solstice iceberg glacier forest steward warden dendrite rite frosty stew");
  const [inventory, setInventory] = useState([]);
  const [chain, setChain] = useState([]); 
  const [draggedItem, setDraggedItem] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(null);
  const [view, setView] = useState('builder'); 
  const [isBridgeLoading, setIsBridgeLoading] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCSV, setCopiedCSV] = useState(false);
  const [progress, setProgress] = useState(0);
  const [targetLength, setTargetLength] = useState(15);
  const [showInput, setShowInput] = useState(false);
  
  // Clue State
  const [clues, setClues] = useState({}); 
  const [definitions, setDefinitions] = useState({});
  const [clueDifficulty, setClueDifficulty] = useState('easy');
  const [loadingClues, setLoadingClues] = useState({});

  // History Stacks
  const [history, setHistory] = useState([]);
  const [clueHistory, setClueHistory] = useState({}); 
  
  // --- Actions ---
  
  const saveToHistory = () => {
      setHistory(prev => [...prev, chain]);
  };

  const handleUndo = () => {
      if (history.length === 0) return;
      const previousChain = history[history.length - 1];
      setChain(previousChain);
      setHistory(prev => prev.slice(0, -1));
  };

  const flattenChain = useMemo(() => {
      if (chain.length === 0) return [];
      let flatWords = [];
      if (chain[0].words.length > 0) flatWords.push(chain[0].words[0]);

      for (let i = 0; i < chain.length; i++) {
          const item = chain[i];
          let startIndex = 0;
          const lastFlat = flatWords[flatWords.length - 1];
          if (lastFlat && cleanWord(lastFlat) === cleanWord(item.words[0])) {
              startIndex = 1;
          }
          for (let j = startIndex; j < item.words.length; j++) {
              flatWords.push(item.words[j]);
          }
      }
      return flatWords;
  }, [chain]);

  // Broken Chain Check
  const hasBrokenLinks = useMemo(() => {
    for (let i = 0; i < chain.length; i++) {
         if (i === 0) continue;
         const prev = chain[i-1];
         const curr = chain[i];
         const prevEnd = prev.endWord;
         const currStart = curr.startWord;
         // Allow 1 char overlap for validity, matching Bridge search logic
         if (!getOverlap(prevEnd, currStart, 1) && cleanWord(prevEnd) !== cleanWord(currStart)) {
             return true;
         }
    }
    return false;
  }, [chain]);

  // Clue Generation
  const updateClueState = (index, newClue) => {
      setClues(prev => ({ ...prev, [index]: newClue }));
      
      setClueHistory(prev => {
          const currentHistory = prev[index] || { past: [], future: [] };
          const currentVal = clues[index];
          if (currentVal !== undefined && currentVal !== newClue) {
              return {
                  ...prev,
                  [index]: {
                      past: [...currentHistory.past, currentVal],
                      future: [] 
                  }
              };
          }
          return prev;
      });
  };

  const undoClue = (index) => {
      setClueHistory(prev => {
          const hist = prev[index];
          if (!hist || hist.past.length === 0) return prev;
          
          const newPast = [...hist.past];
          const previousVal = newPast.pop();
          const currentVal = clues[index];
          
          setClues(c => ({ ...c, [index]: previousVal }));

          return {
              ...prev,
              [index]: {
                  past: newPast,
                  future: [currentVal, ...hist.future]
              }
          };
      });
  };

  const redoClue = (index) => {
      setClueHistory(prev => {
          const hist = prev[index];
          if (!hist || hist.future.length === 0) return prev;
          
          const newFuture = [...hist.future];
          const nextVal = newFuture.shift();
          const currentVal = clues[index];
          
          setClues(c => ({ ...c, [index]: nextVal }));

          return {
              ...prev,
              [index]: {
                  past: [...hist.past, currentVal],
                  future: newFuture
              }
          };
      });
  };

  const generateClues = async (forceRegenIndex = null) => {
      const flat = flattenChain;
      
      const wordsToProcess = forceRegenIndex !== null 
          ? [ { word: flat[forceRegenIndex], index: forceRegenIndex } ]
          : flat.map((w, i) => ({ word: w, index: i }));

      // Set Loading
      setLoadingClues(prev => {
          const next = { ...prev };
          wordsToProcess.forEach(item => next[item.index] = true);
          return next;
      });

      let newDefs = { ...definitions };

      for (const item of wordsToProcess) {
          if (forceRegenIndex !== null || !clues[item.index]) {
              const { clue, definition } = await fetchClueData(item.word, clueDifficulty);
              
              if (forceRegenIndex !== null) {
                  updateClueState(item.index, clue);
              } else {
                  setClues(prev => ({ ...prev, [item.index]: clue }));
              }
              
              newDefs[item.index] = definition;
              
              setLoadingClues(prev => {
                  const next = { ...prev };
                  delete next[item.index];
                  return next;
              });

              if (forceRegenIndex === null) await new Promise(r => setTimeout(r, 300));
          } else {
              setLoadingClues(prev => {
                  const next = { ...prev };
                  delete next[item.index];
                  return next;
              });
          }
      }
      
      setDefinitions(prev => ({...prev, ...newDefs}));
  };
  
  const handleRegenerateAll = () => {
      const flat = flattenChain;
      
      // Set all to loading
      const loadingState = {};
      flat.forEach((_, i) => loadingState[i] = true);
      setLoadingClues(loadingState);

      const processAll = async () => {
          let newDefs = {};
          for (let i = 0; i < flat.length; i++) {
               const { clue, definition } = await fetchClueData(flat[i], clueDifficulty);
               updateClueState(i, clue);
               newDefs[i] = definition;
               
               // Clear loading one by one
               setLoadingClues(prev => {
                   const next = { ...prev };
                   delete next[i];
                   return next;
               });

               await new Promise(r => setTimeout(r, 300));
          }
          setDefinitions(prev => ({...prev, ...newDefs}));
      };
      processAll();
  };

  const handleSwitchToClues = () => {
      if (hasBrokenLinks) return;
      setView('clues');
      const flat = flattenChain;
      const missingCount = flat.filter((_, i) => !clues[i]).length;
      if (missingCount > 0) {
          generateClues();
      }
  };

  const handleClueChange = (index, text) => {
     setClues(prev => ({ ...prev, [index]: text }));
  };
  
  const fetchRandomWords = async () => {
    const TOPICS = ["nature", "city", "technology", "food", "travel", "music", "science", "abstract", "history", "art", "ocean", "space"];
    const shuffledTopics = shuffleArray(TOPICS).slice(0, 3);
    
    let allWords = [];
    try {
        const promises = shuffledTopics.map(topic => 
            fetch(`https://api.datamuse.com/words?ml=${topic}&max=400&md=f`)
                .then(res => res.json())
        );
        
        const results = await Promise.all(promises);
        results.forEach(data => {
            const words = data
                .filter(d => {
                    if (!d.tags) return false;
                    const freqTag = d.tags.find(t => t.startsWith('f:'));
                    // Higher frequency threshold for common words
                    return freqTag && parseFloat(freqTag.split(':')[1]) > 1.5; 
                })
                .map(d => d.word);
            allWords.push(...words);
        });
    } catch (e) {
        console.error("Fetch failed", e);
    }
    
    allWords = [...new Set(allWords)];
    allWords = filterBadWords(allWords);
    return shuffleArray(allWords).slice(0, 1000);
  };

  const handleGenerateAndBuild = async () => {
    saveToHistory();
    setIsProcessing(true);
    setProgress(10);
    setChain([]);
    setClues({}); 
    setClueHistory({});
    setDefinitions({});
    
    try {
        const words = await fetchRandomWords();
        setInputText(words.join(" "));
        setProgress(40);

        const result = await processWordsToInventory(words, targetLength, setProgress, true); 
        setInventory(result.inventory);
        
        setProgress(70);

        const organizedChain = processInventoryToMultiChain(result.inventory, targetLength);
        setChain(organizedChain);
        
    } catch (e) {
        console.error(e);
    }
    
    setIsProcessing(false);
    setProgress(0);
  };

  const handleBuildFromText = () => {
      saveToHistory();
      setIsProcessing(true);
      setChain([]);
      setClues({});
      setClueHistory({});
      setDefinitions({});
      setProgress(20);
      
      setTimeout(async () => {
          const words = inputText.split(/[\s,\n]+/).filter(w => w.length > 1);
          const result = await processWordsToInventory(words, targetLength, setProgress, true);
          setInventory(result.inventory);
          
          setProgress(70);
          
          const organizedChain = processInventoryToMultiChain(result.inventory, targetLength);
          setChain(organizedChain);
          
          setIsProcessing(false);
          setProgress(0);
      }, 100);
  };

  const handleCopyCSV = () => {
      const flatWords = flattenChain;
      if (flatWords.length === 0) return;
      copyToClipboard(flatWords.join(", "));
      setCopiedCSV(true);
      setTimeout(() => setCopiedCSV(false), 2000);
  };

  const handleExportJSON = () => {
      if (chain.length === 0) return;

      const flatWords = flattenChain;
      let currentIndex = 1;
      const exportData = flatWords.map((word, idx) => {
          const wLen = word.length;
          const thisStart = currentIndex;
          
          if (idx < flatWords.length - 1) {
              const nextWord = flatWords[idx + 1];
              const ov = getOverlap(word, nextWord, 1);
              const overlapCount = ov ? ov.count : 0;
              
              currentIndex = currentIndex + wLen - overlapCount;
          }
          
          return {
              clue: clues[idx] || "", 
              answer: word.toUpperCase(),
              start: thisStart,
              height: "full" 
          };
      });

      exportData.forEach(d => {
          d.end = d.start + d.answer.length - 1;
      });

      const heights = ["full", "mid", "inner"];
      
      exportData.forEach((item, i) => {
          const usedHeights = new Set();
          for (let j = 0; j < i; j++) {
              const prev = exportData[j];
              // Strict overlap check for height assignment
              if (prev.end >= item.start) {
                  usedHeights.add(prev.height);
              }
          }
          
          const preferenceIndex = i % 3;
          const preferredOrder = [
              heights[preferenceIndex],
              heights[(preferenceIndex + 1) % 3],
              heights[(preferenceIndex + 2) % 3]
          ];
          
          let assigned = preferredOrder.find(h => !usedHeights.has(h)) || "full";
          item.height = assigned;
          delete item.end;
      });

      const cleanWords = exportData.map(({ end, ...rest }) => rest);
      const dateKey = new Date().toISOString().split('T')[0];

      const finalOutput = {
          title: "",
          type: "chain",
          palette: "greens",
          dateKey: dateKey,
          words: cleanWords
      };
      
      copyToClipboard(JSON.stringify(finalOutput, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  const addToChain = (item) => {
      saveToHistory();
      setChain(prev => [...prev, item]);
  };
  
  const removeFromChain = (index) => {
      saveToHistory();
      setChain(prev => prev.filter((_, i) => i !== index));
  };
  
  const clearChain = () => {
      saveToHistory();
      setChain([]);
      setClues({});
  };

  const handleFindBridge = async (index) => {
    const leftItem = chain[index];
    const rightItem = chain[index + 1];
    if (!leftItem || !rightItem) return;

    setIsBridgeLoading(true);
    
    const startWord = leftItem.endWord;
    const endWord = rightItem.startWord;
    
    const suffix = cleanWord(startWord).slice(-(cleanWord(startWord).length >= 4 ? 3 : 2));
    const prefix = cleanWord(endWord).slice(0, (cleanWord(endWord).length >= 4 ? 3 : 2));
    
    let solutions = [];
    let fwdOptions = [];
    let bwdOptions = [];

    const isValid = (d, avoid1, avoid2) => {
        if (!/^[a-zA-Z]+$/.test(d.word)) return false;
        if (d.word.length < 3) return false;
        const w = cleanWord(d.word);
        if (avoid1 && w === cleanWord(avoid1)) return false;
        if (avoid2 && w === cleanWord(avoid2)) return false;
        if (avoid1 && isDerivative(w, avoid1)) return false;
        if (avoid2 && isDerivative(w, avoid2)) return false;
        const freq = d.tags ? parseFloat(d.tags[0].split(':')[1]) : 0;
        return freq > 0.2; 
    };

    try {
        setBridgeStatus("Searching depth 1 (Direct)...");
        const queryDirect = `${suffix}*${prefix}`;
        const fwdQuery = `${suffix}*`;
        const bwdQuery = `*${prefix}`;

        const [resDirect, resFwd, resBwd] = await Promise.all([
            fetch(`https://api.datamuse.com/words?sp=${queryDirect}&max=25&md=f`),
            fetch(`https://api.datamuse.com/words?sp=${fwdQuery}&max=40&md=f`),
            fetch(`https://api.datamuse.com/words?sp=${bwdQuery}&max=40&md=f`)
        ]);

        const [dataDirect, dataFwd, dataBwd] = await Promise.all([resDirect.json(), resFwd.json(), resBwd.json()]);

        const oneWordBridges = dataDirect
            .filter(d => isValid(d, startWord, endWord))
            .map(d => ({
                id: `sol-1-${d.word}`,
                words: [d.word],
                length: 1,
                startWord: d.word,
                endWord: d.word,
                type: 'bridge'
            }));
        
        solutions = [...oneWordBridges];

        const validFwd = dataFwd.filter(d => isValid(d, startWord, null));
        const validBwd = dataBwd.filter(d => isValid(d, null, endWord));
        
        // Populate fallback lists - sort by overlap length with respective target
        fwdOptions = validFwd.map(d => {
             const ov = getOverlap(startWord, d.word, 1);
             return {id:`fwd-${d.word}`, words:[d.word], length:1, type:'bridge', overlap: ov ? ov.count : 0};
        }).sort((a,b) => b.overlap - a.overlap).slice(0, 10);
        
        bwdOptions = validBwd.map(d => {
             const ov = getOverlap(d.word, endWord, 1);
             return {id:`bwd-${d.word}`, words:[d.word], length:1, type:'bridge', overlap: ov ? ov.count : 0};
        }).sort((a,b) => b.overlap - a.overlap).slice(0, 10);
        
        // If we found nothing for lists using stricter suffixes, try a 1-char fallback
        if (fwdOptions.length === 0) {
            const shortSuffix = cleanWord(startWord).slice(-1);
            const resShort = await fetch(`https://api.datamuse.com/words?sp=${shortSuffix}*&max=10&md=f`);
            const dataShort = await resShort.json();
            fwdOptions = dataShort.filter(d => isValid(d, startWord, null)).map(d => ({id:`fwd-${d.word}`, words:[d.word], length:1, type:'bridge'}));
        }
         if (bwdOptions.length === 0) {
            const shortPrefix = cleanWord(endWord).slice(0, 1);
            const resShort = await fetch(`https://api.datamuse.com/words?sp=*${shortPrefix}&max=10&md=f`);
            const dataShort = await resShort.json();
            bwdOptions = dataShort.filter(d => isValid(d, null, endWord)).map(d => ({id:`bwd-${d.word}`, words:[d.word], length:1, type:'bridge'}));
        }

        var manualOptions = { forward: fwdOptions, backward: bwdOptions };

        if (solutions.length < 5) {
            setBridgeStatus("Searching depth 2 (Chain)...");
            const twoStepSolutions = [];
            for (const f of validFwd) {
                for (const b of validBwd) {
                    if (f.word === b.word) continue;
                    if (getOverlap(f.word, b.word, 1)) {
                        if (isDerivative(f.word, b.word)) continue;
                        
                        twoStepSolutions.push({
                            id: `sol-2-${f.word}-${b.word}`,
                            words: [f.word, b.word],
                            length: 2,
                            startWord: f.word,
                            endWord: b.word,
                            type: 'bridge'
                        });
                        if (twoStepSolutions.length > 20) break;
                    }
                }
                if (twoStepSolutions.length > 20) break;
            }
            solutions = [...solutions, ...twoStepSolutions];
        }

        solutions.sort((a, b) => a.length - b.length);

    } catch (e) {
        console.error(e);
        setBridgeStatus("Error fetching bridges.");
    } finally {
        setIsBridgeLoading(false);
    }
    
    setBridgeStatus(""); 
    setShowBridgeModal({ index, solutions, ...manualOptions });
  };

  const insertBridge = (solution) => {
    saveToHistory();
    const { index } = showBridgeModal;
    const words = solution.words;
    let overlaps = [];
    
    if (words.length > 1) {
        for(let i=0; i<words.length-1; i++) {
            const ov = getOverlap(words[i], words[i+1], 1);
            if(ov) overlaps.push(ov);
            else overlaps.push({overlapStr: '?', count: 0});
        }
    }

    const bridgeItem = {
        id: `bridge-${Date.now()}`,
        words: words,
        type: 'bridge',
        startWord: words[0],
        endWord: words[words.length - 1],
        overlaps: overlaps,
        totalOverlap: 0 
    };

    const newChain = [...chain];
    newChain.splice(index + 1, 0, bridgeItem);
    setChain(newChain);
    setShowBridgeModal(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20">
      
      {/* Modal for Bridges */}
      {showBridgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[80vh] flex flex-col">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <Hammer size={18} className="text-indigo-600" />
                    Repair Chain Gap
                </h3>
                <button onClick={() => setShowBridgeModal(null)} className="text-slate-400 hover:text-slate-600">
                    <X size={20} />
                </button>
             </div>
             
             <div className="mb-4 text-sm text-slate-600 text-center bg-slate-50 p-4 rounded-lg border border-slate-100 flex-shrink-0">
                <div className="flex items-center justify-center gap-2 text-lg">
                    <span className="font-bold text-indigo-700">{chain[showBridgeModal.index].endWord}</span>
                    <span className="text-slate-300">...</span>
                    <span className="font-bold text-indigo-700">{chain[showBridgeModal.index + 1].startWord}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">Select the best path</div>
             </div>

             <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                {isBridgeLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                        <RefreshCw className="animate-spin mb-2" />
                        <span>{bridgeStatus || "Searching dictionary..."}</span>
                    </div>
                ) : (
                    <>
                        {showBridgeModal.solutions && showBridgeModal.solutions.length > 0 ? (
                            showBridgeModal.solutions.map(sol => (
                                <button 
                                    key={sol.id} 
                                    onClick={() => insertBridge(sol)} 
                                    className={`
                                        w-full text-left px-4 py-3 border rounded-lg text-sm font-medium transition-colors flex items-center justify-between group
                                        ${sol.length === 1 ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100' : 
                                          sol.length === 2 ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100' :
                                          'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-indigo-300'}
                                    `}
                                >
                                    <div className="flex items-center gap-2">
                                        {sol.words.map((w, i) => (
                                            <React.Fragment key={i}>
                                                {i > 0 && <ArrowRight size={12} className="text-slate-400" />}
                                                <span>{w}</span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                    <div className="text-xs opacity-50 font-normal flex items-center gap-1">
                                        {sol.length === 1 && <CheckCircle2 size={12} className="text-emerald-500" />}
                                        {sol.length} word{sol.length>1?'s':''}
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="text-center text-sm text-slate-400 italic p-4">
                                No complete bridges found.
                            </div>
                        )}

                        {/* Manual Fallbacks */}
                        {(showBridgeModal.forward?.length > 0 || showBridgeModal.backward?.length > 0) && (
                            <div className="pt-4 border-t border-slate-100">
                                <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wide mb-3 text-center">Manual Construction</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                                            <ArrowRight size={10} /> Extend Left
                                        </h5>
                                        <div className="space-y-2">
                                            {showBridgeModal.forward?.map(item => (
                                                <button key={item.id} onClick={() => insertBridge(item)} className="w-full text-left px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 rounded text-xs text-slate-700 transition-colors truncate">
                                                    {item.words[0]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                                            <ArrowLeft size={10} /> Precede Right
                                        </h5>
                                        <div className="space-y-2">
                                            {showBridgeModal.backward?.map(item => (
                                                <button key={item.id} onClick={() => insertBridge(item)} className="w-full text-left px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 rounded text-xs text-slate-700 transition-colors truncate">
                                                    {item.words[0]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
             </div>
          </Card>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 text-white p-1.5 rounded-lg">
              <LinkIcon size={20} />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-purple-600">
              WordChain
            </h1>
          </div>
          {isProcessing && (
            <div className="absolute bottom-0 left-0 h-1 w-full bg-slate-100">
                <div 
                    className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-8">
        
        {view === 'builder' ? (
            <>
            <div className="w-full">
            <Card className="p-4 bg-slate-50 border-slate-200">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Target Length</label>
                            <div className="flex items-center gap-4 bg-white p-2 rounded-lg border border-slate-200">
                                <input 
                                    type="range" 
                                    min="5" 
                                    max="50" 
                                    value={targetLength}
                                    onChange={(e) => setTargetLength(parseInt(e.target.value))}
                                    className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <span className="text-sm font-bold text-indigo-600 w-8 text-center">{targetLength}</span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button 
                                onClick={handleGenerateAndBuild} 
                                disabled={isProcessing} 
                                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md"
                            >
                            {isProcessing ? <RefreshCw className="animate-spin" size={18} /> : <Wand2 size={18} />}
                            Random 1k & Solve
                            </Button>
                            <Button 
                                onClick={handleBuildFromText} 
                                disabled={isProcessing} 
                                variant="secondary"
                                className="bg-white hover:bg-slate-50"
                            >
                            <AlignLeft size={18} /> Build from Text
                            </Button>
                        </div>

                        <button 
                            onClick={() => setShowInput(!showInput)}
                            className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            {showInput ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                    </div>

                    {showInput && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Source Words</label>
                                <span className="text-xs text-slate-400">{inputText.split(/\s+/).filter(w=>w).length} words</span>
                            </div>
                            <textarea
                                className="w-full h-32 p-3 text-sm bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none transition-all shadow-sm"
                                placeholder="e.g. solstice iceberg glacier..."
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                            />
                        </div>
                    )}
                </div>
            </Card>
            </div>

            <div className="flex-1 min-h-[500px]">
            <Card className="h-full flex flex-col overflow-hidden bg-white shadow-md border-indigo-100/50">
                <div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                    <LinkIcon size={18} className="text-indigo-600" />
                    Chain Sequence
                </h2>
                <div className="flex gap-2">
                    <Button 
                        variant="ghost" 
                        onClick={handleUndo} 
                        disabled={history.length === 0} 
                        className="text-sm h-9 px-3 border border-slate-200" 
                        title="Undo"
                    >
                        <Undo size={16} className="text-slate-600" />
                    </Button>

                    <Button variant="ghost" onClick={handleCopyCSV} className={`text-sm h-9 px-3 border border-slate-200 ${copiedCSV ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-slate-600'}`} title="Copy Word List">
                        {copiedCSV ? <Check size={16} /> : <Type size={16} />}
                        <span className="ml-2 hidden sm:inline">List</span>
                    </Button>
                    
                    <Button variant="ghost" onClick={clearChain} disabled={chain.length === 0} className="text-sm h-9 px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 size={16} /> <span className="ml-2 hidden sm:inline">Clear</span>
                    </Button>

                    <Button 
                        onClick={handleSwitchToClues} 
                        disabled={hasBrokenLinks}
                        className={`ml-2 ${hasBrokenLinks ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                        title={hasBrokenLinks ? "Fix broken links first" : ""}
                    >
                        {hasBrokenLinks ? <AlertTriangle size={16} /> : <ArrowRight size={16} />}
                        <span className="ml-2">Next: Create Clues</span>
                    </Button>
                </div>
                </div>

                <div 
                className={`
                    flex-1 overflow-y-auto p-8 transition-colors duration-200 relative bg-slate-50/30
                    ${chain.length === 0 ? 'flex items-center justify-center' : ''}
                `}
                >
                {chain.length === 0 ? (
                    <div className="text-center text-slate-400 pointer-events-none">
                    <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                        <Layers size={40} />
                    </div>
                    <p className="text-xl font-medium text-slate-600">Ready to build</p>
                    <p className="text-sm mt-2 text-slate-400">Click "Random 1k & Solve" to start</p>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-y-8 gap-x-0 content-start max-w-5xl mx-auto">
                    {(() => {
                        let lastDisplayEndWord = null;
                        const overlapBadgeClass = (count) => {
                            if (count >= 4) return "text-indigo-700 font-bold text-xs";
                            if (count >= 3) return "text-indigo-600 font-semibold text-[11px]";
                            return "text-indigo-500 font-medium text-[10px]";
                        };

                        return chain.map((link, idx) => {
                            const prevLink = chain[idx - 1];

                            // Determine which words to show on the card
                            let wordsToShow = link.words;
                            if (link.type === 'pair' || link.type === 'bridge') {
                                wordsToShow = idx === 0 ? [link.words[0]] : [link.words[link.words.length - 1]];
                            } else if (link.type === 'triple') {
                                wordsToShow = link.words; // always show all three
                            }

                            const visibleStart = wordsToShow[0] || link.words[0];
                            const overlapWithPrev = lastDisplayEndWord
                                ? (getOverlap(lastDisplayEndWord, visibleStart, 1)?.count ?? 0)
                                : null;

                            // Broken link check uses actual chain linkage
                            let isBroken = false;
                            if (prevLink) {
                                const prevEnd = prevLink.endWord;
                                const currStart = link.startWord;
                                const overlap = getOverlap(prevEnd, currStart, 1);
                                if (!overlap && cleanWord(prevEnd) !== cleanWord(currStart)) {
                                    isBroken = true;
                                }
                            }

                            const card = (
                                <React.Fragment key={link.id + idx}>
                                
                                {idx > 0 && (
                                    <div className="mx-1 relative flex flex-col items-center justify-center min-w-[3rem]">
                                        {!isBroken ? (
                                            <>
                                                {overlapWithPrev !== null && (
                                                    <div className={`${overlapBadgeClass(overlapWithPrev)} font-mono mb-1`}>
                                                        {overlapWithPrev}
                                                    </div>
                                                )}
                                                <div className="w-full h-0.5 bg-indigo-200 relative">
                                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-400 rounded-full"></div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300 z-10">
                                                <Button 
                                                    variant="warning" 
                                                    size="small" 
                                                    className="text-[10px] h-6 px-2 py-0 shadow-sm whitespace-nowrap"
                                                    onClick={() => handleFindBridge(idx - 1)}
                                                >
                                                    <Hammer size={10} /> Repair
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="relative group animate-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <button 
                                        onClick={() => removeFromChain(idx)}
                                        className="absolute -top-2 -right-2 bg-white text-slate-400 hover:text-rose-500 border border-slate-200 shadow-sm p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all z-20 hover:scale-110"
                                    >
                                    <X size={10} />
                                    </button>
                                    
                                    <div className={`
                                        flex items-center px-4 py-3 bg-white rounded-xl shadow-sm border transition-all hover:shadow-md
                                        ${isBroken ? 'border-rose-300 ring-2 ring-rose-50' : 'border-indigo-100'}
                                        ${link.type === 'triple' ? 'ring-2 ring-sky-50 border-sky-100 bg-sky-50/30' : ''}
                                    `}>
                                        {/* Header Badge */}
                                        {link.type === 'triple' && (
                                            <div className="absolute -top-3 left-3 bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-sky-600 shadow-sm">
                                                Triple
                                            </div>
                                        )}

                                        {wordsToShow.map((w, wIdx) => (
                                            <React.Fragment key={wIdx}>
                                                {wIdx > 0 && link.type === 'triple' && (
                                                    <div className="mx-2 flex flex-col items-center">
                                                        {link.overlaps && link.overlaps[wIdx-1] && (
                                                            <span className={`${overlapBadgeClass(link.overlaps[wIdx-1].count)} font-mono mb-0.5`}>
                                                                {link.overlaps[wIdx-1].count}
                                                            </span>
                                                        )}
                                                        <ArrowRight size={14} className="text-slate-300" />
                                                    </div>
                                                )}
                                                
                                                <span className="font-bold text-slate-700">
                                                    {w}
                                                </span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                                </React.Fragment>
                            );

                            // Track visible end word for the next connector computation
                            lastDisplayEndWord = wordsToShow[wordsToShow.length - 1] || lastDisplayEndWord;
                            return card;
                        });
                    })()}
                    </div>
                )}
                </div>
                <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
                <div>Chain Length: {chain.length} links</div>
                <div>Total Words: {chain.length > 0 ? chain.reduce((acc, item) => acc + (item.words.length - 1), 1) : 0}</div>
                </div>
            </Card>
            </div>
            </>
        ) : (
            // CLUE EDITOR VIEW
            <div className="w-full flex-1">
                <Card className="h-full flex flex-col overflow-hidden bg-white shadow-md border-indigo-100/50">
                    <div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center sticky top-0 z-10">
                        <div className="flex items-center gap-4">
                            <Button variant="secondary" onClick={() => setView('builder')} className="text-sm">
                                <ArrowLeftCircle size={18} /> Back to Build
                            </Button>
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2 border-l border-slate-200 pl-4">
                                <PenTool size={18} className="text-indigo-600" />
                                Edit Clues
                            </h2>
                        </div>
                        <div className="flex items-center gap-4">
                            <Button onClick={handleRegenerateAll} className="text-sm h-9 px-4 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">
                                <RefreshCw size={14} className={Object.keys(loadingClues).length > 0 ? "animate-spin" : ""} /> Regenerate All
                            </Button>
                            <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
                                {['easy', 'medium', 'hard'].map(level => (
                                    <button
                                        key={level}
                                        onClick={() => setClueDifficulty(level)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${clueDifficulty === level ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {level}
                                    </button>
                                ))}
                            </div>
                            <Button 
                                onClick={handleExportJSON} 
                                className={`text-sm h-9 px-4 ${copied ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white shadow-md`}
                            >
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                                <span className="ml-2">Export JSON</span>
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                        <div className="max-w-4xl mx-auto space-y-3">
                            {flattenChain.map((word, idx) => (
                                <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 group hover:border-indigo-200 transition-colors">
                                    <div className="flex items-start gap-4">
                                        <div className="flex-shrink-0 w-8 h-8 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm mt-1">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <div className="font-bold text-slate-800 text-lg">{word.toUpperCase()}</div>
                                            </div>
                                            
                                            {/* Definition Always Visible */}
                                            <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded italic border border-slate-100">
                                                {definitions[idx] || "Loading definition..."}
                                            </div>

                                            <div className="flex gap-2 items-center">
                                                <input 
                                                    type="text" 
                                                    value={clues[idx] || ""} 
                                                    onChange={(e) => handleClueChange(idx, e.target.value)}
                                                    className="flex-1 p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-slate-50 focus:bg-white transition-all"
                                                    placeholder={loadingClues[idx] ? "Generating..." : "Enter clue..."}
                                                />
                                                <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                                                    <button 
                                                        onClick={() => undoClue(idx)}
                                                        disabled={!(clueHistory[idx]?.past?.length > 0)}
                                                        className="p-1.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                                                        title="Undo change"
                                                    >
                                                        <Undo size={14} />
                                                    </button>
                                                    <button 
                                                        onClick={() => redoClue(idx)}
                                                        disabled={!(clueHistory[idx]?.future?.length > 0)}
                                                        className="p-1.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                                                        title="Redo change"
                                                    >
                                                        <Redo size={14} />
                                                    </button>
                                                </div>
                                                <button 
                                                    onClick={() => generateClues(idx)}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100"
                                                    title="Regenerate this clue"
                                                >
                                                    <RefreshCw size={18} className={loadingClues[idx] ? "animate-spin" : ""} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            </div>
        )}

      </main>
    </div>
  );
}

// Auto-mount when included directly in a browser via <script type="module" src="./puzzle-gen.js">
if (typeof document !== 'undefined') {
  const ROOT_ID = 'puzzle-gen-root';
  let mountNode = document.getElementById(ROOT_ID);

  if (!mountNode) {
    mountNode = document.createElement('div');
    mountNode.id = ROOT_ID;
    mountNode.style.minHeight = '100vh';
    document.body.appendChild(mountNode);
  }

  const root = window.__puzzleGenRoot || createRoot(mountNode);
  window.__puzzleGenRoot = root;

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
