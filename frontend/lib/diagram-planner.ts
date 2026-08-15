/**
 * Technical Diagram Planner & Auto-Repair Engine
 * Generates and validates deterministic SVG diagrams from PDF content.
 * Supports: flowchart, architecture, er, class, sequence, mindmap, process.
 */

export type DiagramType =
  | 'flowchart'
  | 'architecture'
  | 'er'
  | 'class'
  | 'sequence'
  | 'mindmap'
  | 'process';

export interface DiagramPlanResult {
  diagramType: DiagramType;
  mermaidCode: string;
  isRepaired: boolean;
  nodesCount: number;
  groundedSource?: string;
}

/**
 * Detects diagram type from user query
 */
export function detectDiagramType(query: string): DiagramType {
  const q = query.toLowerCase();

  if (q.includes('sequence') || q.includes('interaction') || q.includes('message flow')) {
    return 'sequence';
  }
  if (q.includes('architecture') || q.includes('system design') || q.includes('infrastructure') || q.includes('stack')) {
    return 'architecture';
  }
  if (q.includes('entity') || q.includes('er diagram') || q.includes('database schema') || q.includes('relational')) {
    return 'er';
  }
  if (q.includes('class') || q.includes('object model') || q.includes('oop')) {
    return 'class';
  }
  if (q.includes('mindmap') || q.includes('brainstorm') || q.includes('concept map')) {
    return 'mindmap';
  }
  if (q.includes('process') || q.includes('pipeline') || q.includes('lifecycle') || q.includes('stage')) {
    return 'process';
  }

  return 'flowchart';
}

/**
 * Generates a technical diagram grounded in PDF context
 */
export function planTechnicalDiagram(
  query: string,
  pdfContext: string,
  rawAiMermaid?: string
): DiagramPlanResult {
  const diagramType = detectDiagramType(query);

  let initialCode = rawAiMermaid || '';

  if (!initialCode) {
    initialCode = generateStructuredMermaid(query, pdfContext, diagramType);
  }

  const { cleanCode, isRepaired } = validateAndRepairMermaid(initialCode, diagramType, pdfContext);

  const nodeMatches = cleanCode.match(/(\[[^\]]+\]|\{[^}]+\}|\([^)]+\)|-->|->>)/g);
  const nodesCount = nodeMatches ? nodeMatches.length : 6;

  return {
    diagramType,
    mermaidCode: cleanCode,
    isRepaired,
    nodesCount,
  };
}

/**
 * Deterministically constructs a structured diagram based on PDF facts and diagram type
 */
function generateStructuredMermaid(query: string, pdfContext: string, type: DiagramType): string {
  const facts = extractDiagramFacts(pdfContext, query);

  if (type === 'sequence') {
    return `sequenceDiagram
  autonumber
  actor User as User / Client
  participant API as API Gateway / Service
  participant DB as Database / Storage
  participant Engine as AI Intelligence Engine

  User->>API: 1. Submit Request (${facts[0] || 'PDF Context Query'})
  API->>DB: 2. Query Relevant Document Data
  DB-->>API: 3. Return Context Chunks
  API->>Engine: 4. Process Context & Synthesize
  Engine-->>API: 5. Return Structured Result
  API-->>User: 6. Display Output (${facts[1] || 'Synthesized Answer'})`;
  }

  if (type === 'architecture') {
    return `graph TD
  subgraph Client_Layer["Client & User Interface"]
    User["User Query"] --> UI["Web App Frontend"]
  end

  subgraph Processing_Layer["Application & RAG Pipeline"]
    UI --> Router["Output Router"]
    Router --> RAG["LangChain RAG Engine"]
    RAG --> Vector["Vector DB / Document Store"]
  end

  subgraph Intelligence_Layer["AI & Visualization Engine"]
    RAG --> LLM["LLM Synthesis Model"]
    Router --> Diagram["Diagram Planner & SVG Renderer"]
    Router --> Visual["AI Image Generator"]
  end

  LLM --> Output["Grounded Response"]
  Diagram --> Output
  Visual --> Output`;
  }

  if (type === 'er') {
    return `erDiagram
  DOCUMENT ||--o{ CHUNK : contains
  DOCUMENT {
    string id
    string filename
    string source
  }
  CHUNK ||--o{ EMBEDDING : generates
  CHUNK {
    string id
    string pageContent
    json metadata
  }
  EMBEDDING {
    string id
    float[] vector
  }`;
  }

  if (type === 'class') {
    return `classDiagram
  class DocumentProcessor {
    +processPDF(file)
    +cleanText(raw)
  }
  class RAGOrchestrator {
    +getQueryEmbedding(text)
    +hybridRerank(docs)
  }
  class DiagramPlanner {
    +detectType(query)
    +validateAndRepair(code)
  }
  DocumentProcessor <|-- RAGOrchestrator
  RAGOrchestrator --> DiagramPlanner`;
  }

  if (type === 'mindmap') {
    const f1 = (facts[0] || 'Core Subject').replace(/["\\]/g, '');
    const f2 = (facts[1] || 'Key Component A').replace(/["\\]/g, '');
    const f3 = (facts[2] || 'Key Component B').replace(/["\\]/g, '');
    const f4 = (facts[3] || 'Key Component C').replace(/["\\]/g, '');

    return `mindmap
  root("${f1}")
    Subtopic_A("${f2}")
      Detail_A1("Analysis")
      Detail_A2("Verification")
    Subtopic_B("${f3}")
      Detail_B1("Data Extraction")
      Detail_B2("Processing")
    Subtopic_C("${f4}")
      Detail_C1("Output Synthesis")`;
  }

  // Default: Flowchart / Process
  const n1 = (facts[0] || 'Document Ingestion').slice(0, 30);
  const n2 = (facts[1] || 'Text & Fact Extraction').slice(0, 30);
  const n3 = (facts[2] || 'Semantic RAG Analysis').slice(0, 30);
  const n4 = (facts[3] || 'Grounded Synthesis').slice(0, 30);

  return `graph TD
  subgraph Input_Phase["Phase 1: Input & Parsing"]
    A["${n1}"] --> B["${n2}"]
  end
  subgraph Processing_Phase["Phase 2: RAG & Verification"]
    B --> C{"Data Valid?"}
    C -->|"Yes"| D["${n3}"]
    C -->|"No"| E["Re-examine Context"]
    E --> B
  end
  subgraph Output_Phase["Phase 3: Output"]
    D --> F["${n4}"]
  end`;
}

/**
 * Extracts specific facts from PDF context for diagram generation
 */
function extractDiagramFacts(pdfContext: string, query: string): string[] {
  if (!pdfContext) return ['Document Processing', 'Context Analysis', 'Fact Extraction', 'Final Output'];

  const lines = pdfContext
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 15 && !l.startsWith('---'));

  const queryTerms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const matched: string[] = [];

  for (const line of lines) {
    const clean = line.replace(/[^a-zA-Z0-9\s.,-]/g, '').trim();
    if (clean.length >= 10) {
      if (queryTerms.some((t) => clean.toLowerCase().includes(t)) || matched.length < 4) {
        if (!matched.includes(clean)) {
          matched.push(clean.slice(0, 50));
          if (matched.length >= 6) break;
        }
      }
    }
  }

  return matched.length > 0 ? matched : ['Document Input', 'Information Extraction', 'Validation', 'Visual Output'];
}

/**
 * Strict Mermaid Syntax Validator & Auto-Repair Engine
 */
export function validateAndRepairMermaid(
  rawCode: string,
  diagramType: DiagramType = 'flowchart',
  pdfContext: string = ''
): { cleanCode: string; isRepaired: boolean } {
  if (!rawCode || rawCode.trim().length < 5) {
    return {
      cleanCode: generateStructuredMermaid('default', pdfContext, diagramType),
      isRepaired: true,
    };
  }

  let code = rawCode.trim();
  let isRepaired = false;

  // Extract block between ```mermaid and ```
  const match = code.match(/```(?:mermaid)?([\s\S]*?)```/i);
  if (match) {
    code = match[1].trim();
    isRepaired = true;
  } else {
    code = code.replace(/^```(mermaid)?/gi, '').replace(/```$/g, '').trim();
  }

  code = code.replace(/\r\n/g, '\n');

  // Strip emojis and non-standard unicode choking Mermaid parser
  const strippedCode = code.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  if (strippedCode !== code) {
    code = strippedCode;
    isRepaired = true;
  }

  // Ensure header is present
  const validHeaders = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'journey', 'gantt', 'pie', 'gitgraph', 'mindmap', 'timeline',
  ];

  const firstLine = code.split('\n')[0]?.trim() || '';
  const hasHeader = validHeaders.some((h) => firstLine.toLowerCase().startsWith(h.toLowerCase()));

  if (!hasHeader) {
    code = `graph TD\n${code}`;
    isRepaired = true;
  }

  // Clean lines
  let openSubgraphs = 0;
  let sgCount = 1;

  const cleanLines = code.split('\n').map((line) => {
    let l = line.trim();
    if (!l) return '';

    // Strip semicolons and ampersands
    l = l.replace(/;/g, '').replace(/&/g, 'and');

    // Remove style / classDef / linkStyle lines
    if (/^(classDef|class\s|style\s|linkStyle\s)/i.test(l)) {
      isRepaired = true;
      return '';
    }

    // Fix arrow labels: `-->|label|> B` -> `-->|"label"| B`
    if (l.includes('-->|')) {
      l = l.replace(/-->\s*\|+([^|\n]+)\|+>?/g, (m, label) => {
        const cleanLabel = label.replace(/["\\]/g, '').trim();
        return `-->|"${cleanLabel}"|`;
      });
      isRepaired = true;
    }

    // Fix subgraph definitions
    if (l.toLowerCase().startsWith('subgraph')) {
      openSubgraphs++;
      if (!l.includes('[') && !l.match(/^subgraph\s+[A-Za-z0-9_]+\s*$/i)) {
        const title = l.replace(/^subgraph\s+/i, '').replace(/["[\]]/g, '').trim();
        l = `subgraph SG_${sgCount++}["${title || 'Section'}"]`;
        isRepaired = true;
      }
    }

    if (l.toLowerCase() === 'end') {
      if (openSubgraphs > 0) openSubgraphs--;
    }

    // Fix invalid arrow types
    if (l.includes('-->>') || l.includes('--->')) {
      l = l.replace(/-->>/g, '-->').replace(/--->/g, '-->');
      isRepaired = true;
    }

    // Quote unquoted node labels: A[Text] -> A["Text"]
    l = l.replace(/([A-Za-z0-9_]+)\[([^\]"\n]+)\]/g, (m, id, text) => {
      isRepaired = true;
      return `${id}["${text.replace(/"/g, "'").trim()}"]`;
    });

    // Quote unquoted decision labels: A{Text} -> A{"Text"}
    l = l.replace(/([A-Za-z0-9_]+)\{([^}"\n]+)\}/g, (m, id, text) => {
      isRepaired = true;
      return `${id}{"${text.replace(/"/g, "'").trim()}"}`;
    });

    return l;
  });

  // Balance subgraphs
  while (openSubgraphs > 0) {
    cleanLines.push('end');
    openSubgraphs--;
    isRepaired = true;
  }

  const cleanCode = cleanLines.filter(Boolean).join('\n');

  return { cleanCode, isRepaired };
}
