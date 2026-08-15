import { POST } from '../../../app/api/ingest/route';
import { NextRequest } from 'next/server';
import { processDocument } from '@/lib/pdf';

jest.mock('@/lib/pdf', () => ({
  processDocument: jest.fn().mockImplementation((file: File) => {
    return Promise.resolve([
      {
        pageContent: 'Test content',
        metadata: { filename: file.name, source: file.name },
      },
    ]);
  }),
  processPDF: jest.fn().mockImplementation((file: File) => {
    return Promise.resolve([
      {
        pageContent: 'Test content',
        metadata: { filename: file.name, source: file.name },
      },
    ]);
  }),
  SUPPORTED_EXTENSIONS: ['.pdf', '.txt', '.md', '.json', '.csv', '.doc', '.docx', '.xlsx'],
  SUPPORTED_MIME_TYPES: ['application/pdf', 'text/plain', 'text/csv'],
}));

describe('PDF Ingest Route (In-Memory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createMockRequest(formDataEntries: [string, any][]) {
    const mockFormData = {
      entries: () => formDataEntries,
    };
    return {
      headers: {
        get: (headerName: string) => {
          if (headerName.toLowerCase() === 'content-type') return 'multipart/form-data';
          return null;
        },
      },
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

  it('should accept PDF files', async () => {
    const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
    const req = createMockRequest([['files', file]]);

    const response = await POST(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBeDefined();
    expect(data.docHash).toBeDefined();
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
    expect(data.message).toBeDefined();
    expect(data.docHash).toBeDefined();
  });

  it('should correctly parse PDF files using processDocument', async () => {
    const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
    const req = createMockRequest([['files', file]]);

    await POST(req);

    expect(processDocument).toHaveBeenCalledWith(file);
  });
});
