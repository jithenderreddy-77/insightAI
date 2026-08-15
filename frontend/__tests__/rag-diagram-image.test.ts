import { detectDiagramType, validateAndRepairMermaid, planTechnicalDiagram } from '../lib/diagram-planner';
import { generateVisualIllustration } from '../lib/image-generation-service';

describe('PDF RAG Diagram & Gemini AI Image Generation Pipeline', () => {
  beforeAll(() => {
    // Rely on process.env or fallback configuration
    if (!process.env.GEMINI_IMAGE_MODEL) {
      process.env.GEMINI_IMAGE_MODEL = 'imagen-3.0-generate-002';
    }
  });

  describe('1. Technical Diagram Planning & Auto-Repair', () => {
    test('should correctly detect sequence diagram intent', () => {
      expect(detectDiagramType('Create a sequence diagram of user login')).toBe('sequence');
    });

    test('should correctly detect architecture diagram intent', () => {
      expect(detectDiagramType('Show me the system architecture diagram')).toBe('architecture');
    });

    test('should correctly detect ER diagram intent', () => {
      expect(detectDiagramType('Create an ER diagram for database schema')).toBe('er');
    });

    test('should correctly detect flowchart intent by default', () => {
      expect(detectDiagramType('Create a flowchart from this PDF')).toBe('flowchart');
    });

    test('should auto-repair unquoted node labels and missing end statements in invalid Mermaid syntax', () => {
      const invalidSyntax = `
graph TD
  subgraph SG1[Input Phase
    A[Start Process] -->|Yes|> B{Data Valid?}
`;
      const repaired = validateAndRepairMermaid(invalidSyntax, 'flowchart');

      expect(repaired.isRepaired).toBe(true);
      expect(repaired.cleanCode).toContain('graph TD');
      expect(repaired.cleanCode).toContain('end');
      expect(repaired.cleanCode).not.toContain('|Yes|>');
    });

    test('should plan a complete technical diagram grounded in PDF context', () => {
      const samplePdfContext = `
--- DOCUMENT SOURCE: architecture.pdf ---
The application uses a Next.js frontend, a LangChain RAG pipeline, and a Supabase vector store for semantic search.
`;
      const plan = planTechnicalDiagram('Create an architecture diagram', samplePdfContext);

      expect(plan.diagramType).toBe('architecture');
      expect(plan.mermaidCode).toContain('graph TD');
      expect(plan.nodesCount).toBeGreaterThan(0);
    });
  });

  describe('2. Gemini AI Image Generation Service Integration', () => {
    test('should generate grounded visual illustration using Google Gemini service configuration', async () => {
      const samplePdfContext = 'The document explains neural network transformer self-attention mechanisms.';
      const result = await generateVisualIllustration({
        prompt: 'Create a beautiful professional visual explaining this PDF',
        pdfContext: samplePdfContext,
        aspectRatio: '16:9',
        style: 'educational',
      });

      expect(result.success).toBe(true);
      expect(result.imageUrl).toBeDefined();
      expect(typeof result.imageUrl).toBe('string');
      expect(result.groundedFacts).toBeDefined();
      expect(result.groundedFacts!.length).toBeGreaterThan(0);
    });
  });
});
