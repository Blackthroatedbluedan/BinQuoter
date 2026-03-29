
import React, { useState } from 'react';
import { Job, PredictionParams, ManHourPrediction } from '../types';
import { getManHourPrediction } from '../services/ridgeModel';

interface PredictionProps {
  jobs: Job[];
}

const Prediction: React.FC<PredictionProps> = ({ jobs }) => {
  const [params, setParams] = useState<PredictionParams>({
    diameter: 48,
    rings: 8,
    crewSize: 4,
    driveHours: 1,
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
  });
  const [prediction, setPrediction] = useState<ManHourPrediction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
        setParams(prev => ({ ...prev, [name]: checked }));
    } else {
        setParams(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    }
  };

  const handlePredict = () => {
    setError(null);
    setPrediction(null);
    try {
      const result = getManHourPrediction(jobs, params);
      setPrediction(result);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred. Please try again.');
      }
      console.error(err);
    }
  };

  const numberFields = [
      { name: 'diameter', label: 'Diameter (ft)'},
      { name: 'rings', label: 'Rings'},
      { name: 'crewSize', label: 'Crew Size'},
      { name: 'driveHours', label: 'Drive Hours'},
  ];

  const checkboxFields = [
    { name: 'sidedraw', label: 'Sidedraw' },
    { name: 'stirator', label: 'Stirator' },
    { name: 'topDry', label: 'TopDry' },
    { name: 'daySweep', label: 'DaySweep' },
    { name: 'hopperBin', label: 'HopperBin' },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Predict Man Hours</h2>
      <p className="text-sm text-slate-600 mb-4">Enter job details to get a man-hour prediction based on historical data.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {numberFields.map(field => (
            <div key={field.name}>
              <label htmlFor={field.name} className="block text-sm font-medium text-slate-600">{field.label}</label>
              <input
                type="number"
                name={field.name}
                id={field.name}
                value={params[field.name as keyof typeof params] as number}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          ))}
        </div>

        <div>
            <label className="block text-sm font-medium text-slate-600">Additional Features</label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {checkboxFields.map(field => (
                     <label key={field.name} className="flex items-center space-x-2 text-sm">
                        <input 
                          type="checkbox" 
                          name={field.name} 
                          checked={params[field.name as keyof typeof params] as boolean} 
                          onChange={handleChange} 
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                        />
                        <span>{field.label}</span>
                    </label>
                ))}
            </div>
        </div>

        <button onClick={handlePredict} disabled={isLoading} className="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300 transition duration-150 ease-in-out">
          {isLoading ? 'Predicting...' : 'Predict Hours'}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      
      {prediction && (
        <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <h3 className="font-semibold text-slate-800">Prediction Result</h3>
           <div className="mt-2 text-center">
            <p className="text-4xl font-bold text-blue-600">{prediction.predictedHours.toFixed(0)}</p>
            <p className="text-sm text-slate-500">Predicted Man Hours</p>
          </div>
          <div className="mt-4">
            <p className="font-medium text-slate-600 text-sm">Reasoning:</p>
            <p className="text-sm text-slate-500 italic mt-1">{prediction.reasoning}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Prediction;