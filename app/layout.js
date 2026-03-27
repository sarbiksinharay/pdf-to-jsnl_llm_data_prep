import './globals.css';

export const metadata = {
  title: 'PDF Processor | LLM Training Data Generator',
  description: 'Convert PDF documents to structured JSONL training data for LLM fine-tuning',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#09090b]">
        {children}
      </body>
    </html>
  );
}
