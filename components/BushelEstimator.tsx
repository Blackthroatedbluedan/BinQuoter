import React, { useState } from 'react';
import { Job, BinRecommendation, RecommendationParams } from '../types';
import { getBinRecommendation } from '../services/ridgeModel';

interface BushelEstimatorProps {
  jobs: Job[];
}

const BushelEstimator: React.FC<BushelEstimatorProps> = ({ jobs }) => {
  const [params, setParams] = useState<RecommendationParams>({
    desiredBushels: 40, // Default to 40k bushels
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
  });
  const [recommendation, setRecommendation] = useState<BinRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
        setParams(prev => ({...prev, [name]: checked }));
    } else {
        setParams(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    }
  };

  const handleRecommend = () => {
    setError(null);
    setRecommendation(null);
    try {
      const result = getBinRecommendation(jobs, params);
      setRecommendation(result);
    } catch (err) {
      setError('Failed to get recommendation. Please try again.');
      console.error(err);
    }
  };

  const laborCost = recommendation ? recommendation.predictedHours * 60 : 0;

  const checkboxFields = [
    { name: 'sidedraw', label: 'Sidedraw' },
    { name: 'stirator', label: 'Stirator' },
    { name: 'topDry', label: 'TopDry' },
    { name: 'daySweep', label: 'DaySweep' },
    { name: 'hopperBin', label: 'HopperBin' },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Quote by Capacity</h2>
      <p className="text-sm text-slate-600 mb-4">Enter a target capacity to get a bin recommendation and labor cost estimate.</p>
      <div className="space-y-4">
        <div>
            <label htmlFor="desiredBushels" className="block text-sm font-medium text-slate-600">Desired Capacity (Thousand Bushels)</label>
            <input 
              type="number" 
              name="desiredBushels" 
              id="desiredBushels"
              value={params.desiredBushels} 
              onChange={handleChange} 
              className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
            />
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
        <button onClick={handleRecommend} disabled={isLoading} className="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-green-300 transition duration-150 ease-in-out">
          {isLoading ? 'Calculating...' : 'Get Recommendation'}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {recommendation && (
        <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <h3 className="font-semibold text-slate-800">Recommendation</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 text-center">
             <div>
                <p className="text-2xl font-bold text-slate-800">{`Ø${recommendation.recommendedDiameter}' x ${recommendation.recommendedRings} Rings`}</p>
                <p className="text-xs text-slate-500">Recommended Bin Size</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{recommendation.predictedHours.toFixed(0)}</p>
                <p className="text-xs text-slate-500">Predicted Man Hours</p>
              </div>
          </div>
           <div className="mt-4 text-center">
            <p className="text-4xl font-bold text-green-600">{`$${laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
            <p className="text-sm text-slate-500">Estimated Labor Cost (@ $60/hr)</p>
          </div>
          <div className="mt-4">
            <p className="font-medium text-slate-600 text-sm">Reasoning:</p>
            <p className="text-sm text-slate-500 italic mt-1">{recommendation.reasoning}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BushelEstimator;