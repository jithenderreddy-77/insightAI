import { POST } from '../../../app/api/ingest/route'; // Import the actual route handler
import { NextRequest } from 'next/server';
import { processPDF } from '@/lib/pdf';
import { langGraphServerClient } from '@/lib/langgraph-server';

// Mock the processPDF function
jest.mock('@/lib/pdf', () => ({
  processPDF: jest.fn().mockImplementation((file: File) => {
    return Promise.resolve([
      {
        pageContent: 'Test content',
        metadata: { filename: file.name },
      },
    ]);
  }),
}));

// Mock the langGraphServerClient
jest.mock('@/lib/langgraph-server', () => {
  return {
    langGraphServerClient: {
      createThread: jest
        .fn()
        .mockResolvedValue({ thread_id: 'test-thread-id' }),
      client: {
        runs: {
          wait: jest.fn().mockResolvedValue({ status: 'success' }),
          stream: jest.fn().mockImplementation(async function* () {
            yield { data: 'test' };
          }),
        },
      },
    },
  };
});

describe('PDF Ingest Route (In-Memory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createMockRequest(formDataEntries: [string, any][]) {
    const mockFormData = {
      entries: () => formDataEntries,
    };
    return {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as NextRequest;
  }

  it('should reject empty requests', async () => {
    const req = createMockRequest([]);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('No files provided');
  });

  it('should reject non-PDF files', async () => {
    const file = new File(['text content'], 'test.txt', { type: 'text/plain' });
    const req = createMockRequest([['files', file]]);

    const response = await POST(req);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Only PDF files are allowed');
  });

  it('should accept PDF files', async () => {
    const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
    const req = createMockRequest([['files', file]]);

    const response = await POST(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toContain('Documents ingested successfully');
    expect(data.threadId).toBe('test-thread-id');
  });

  it('should handle multiple PDFs', async () => {
    const file1 = new File(['pdf content 1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['pdf content 2'], 'test2.pdf', { type: 'application/pdf' });
    const req = createMockRequest([
      ['files', file1],
      ['files', file2],
    ]);

    const response = await POST(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe('Documents ingested successfully');
    expect(data.threadId).toBe('test-thread-id');
  });

  it('should correctly parse PDF files using PDFLoader', async () => {
    const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
    const req = createMockRequest([['files', file]]);

    await POST(req);

    expect(processPDF).toHaveBeenCalledWith(file);
  });

  it('should call the ingestion graph with the correct data', async () => {
    const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
    const req = createMockRequest([['files', file]]);

    await POST(req);

    expect(langGraphServerClient.createThread).toHaveBeenCalled();
    expect(langGraphServerClient.client.runs.wait).toHaveBeenCalledWith(
      'test-thread-id',
      'ingestion_graph',
      expect.objectContaining({
        input: {
          docs: [
            { pageContent: 'Test content', metadata: { filename: 'test.pdf' } },
          ],
        },
      }),
    );
  });
});
