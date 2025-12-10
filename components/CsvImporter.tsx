import React, { useRef, useState } from 'react';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const CsvImporter: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setImporting(true);
    setMessage(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setImporting(false);
        return;
      }
      try {
        const count = await parseAndUpload(text);
        setMessage({ text: `Successfully imported ${count} jobs!`, type: 'success' });
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (error) {
        console.error(error);
        setMessage({ text: 'Error importing CSV. Please check the file format.', type: 'error' });
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const parseAndUpload = async (csvText: string): Promise<number> => {
    // Split by new line, filtering out empty lines
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return 0; // Need at least header and one row

    const headers = lines[0].split(',').map(h => h.trim());
    const batch = writeBatch(db);
    let count = 0;

    // Helper to find value by header name (case-insensitive partial match)
    const getValue = (rowValues: string[], headerPart: string): string => {
        const index = headers.findIndex(h => h.toLowerCase().includes(headerPart.toLowerCase()));
        if (index === -1 || index >= rowValues.length) return '';
        return rowValues[index].trim();
    };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < 2) continue; // Skip likely invalid lines

      const jobData: any = {};
      
      jobData.customer = getValue(values, 'Customer') || 'Unknown';
      
      const driveStr = getValue(values, 'Drive');
      jobData.driveHours = driveStr ? parseFloat(driveStr) : null;

      const buildStr = getValue(values, 'Build');
      jobData.buildType = ['New', 'Extension', 'Old'].includes(buildStr) ? buildStr : 'New';

      const manufStr = getValue(values, 'Manufacturer');
      jobData.manufacturer = ['Brock', 'Westeel', 'GenericCorp'].includes(manufStr) ? manufStr : 'GenericCorp';

      jobData.diameter = parseFloat(getValue(values, 'Diameter')) || 0;
      jobData.rings = parseFloat(getValue(values, 'Rings')) || 0;
      jobData.bushels = parseFloat(getValue(values, 'Bushels')) || 0;
      
      // Look for "Hours" specifically, trying to avoid "Drive(hrs)" confusion by context or exact match if needed, 
      // but "Hours" usually matches the Man Hours column in your schema.
      // Your header is "Hours", other is "Drive(hrs)". "Hours" is safer to search for "Hours" but "Drive" handles the other.
      // To be safe, let's find the exact column index for "Hours" from the header row if possible, 
      // but based on your file: Customer,Drive(hrs),...,Hours,Guys
      const manHoursIndex = headers.findIndex(h => h === 'Hours');
      jobData.manHours = manHoursIndex !== -1 ? parseFloat(values[manHoursIndex]) : 0;

      const crewStr = getValue(values, 'Guys');
      jobData.crewSize = crewStr ? parseFloat(crewStr) : null;

      // Boolean conversions
      const isYes = (val: string) => val.toLowerCase() === 'yes' || val.toLowerCase() === 'true';
      jobData.sidedraw = isYes(getValue(values, 'Sidedraw'));
      jobData.stirator = isYes(getValue(values, 'Stirator'));
      jobData.topDry = isYes(getValue(values, 'TopDry'));
      jobData.daySweep = isYes(getValue(values, 'DaySweep'));
      jobData.hopperBin = isYes(getValue(values, 'HopperBin'));

      const docRef = doc(collection(db, 'jobs'));
      batch.set(docRef, jobData);
      count++;
    }

    if (count > 0) {
        await batch.commit();
    }
    return count;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md text-center h-full flex flex-col justify-center">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Import CSV Data</h2>
      <p className="text-sm text-slate-600 mb-6">Upload your <code>.csv</code> file to bulk add jobs to the database.</p>
      
      <div className="flex flex-col items-center justify-center space-y-4">
          <label className={`cursor-pointer w-full max-w-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-4 rounded-lg border-2 border-dashed border-slate-300 transition flex items-center justify-center ${importing ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <span className="mr-2 text-xl">📂</span>
              <span>{importing ? 'Importing...' : 'Select CSV File'}</span>
              <input 
                  type="file" 
                  accept=".csv" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  disabled={importing}
              />
          </label>
          
          {message && (
              <div className={`text-sm px-4 py-2 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {message.text}
              </div>
          )}
      </div>
    </div>
  );
};

export default CsvImporter;
