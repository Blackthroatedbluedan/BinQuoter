import React, { useState } from 'react';
import { Job, QuoteParams, QuoteResult } from '../types';
import { getJobQuote } from '../services/ridgeModel';

interface JobQuoteProps {
  jobs: Job[];
}

const fmtMoney = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const JobQuote: React.FC<JobQuoteProps> = ({ jobs }) => {
  const [params, setParams] = useState<QuoteParams>({
    diameter: 48,
    rings: 8,
    labourers: 5,
    foremen: 1,
    driveHours: 1,
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
    machineRental: false,
    manufacturer: 'Brock',
  });
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setParams(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else if (type === 'number') {
      setParams(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    } else {
      setParams(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleQuote = () => {
    setError(null);
    setQuote(null);
    try {
      const result = getJobQuote(jobs, params);
      setQuote(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred.');
      console.error(err);
    }
  };

  const crewSize = params.labourers + params.foremen;

  const numberFields = [
    { name: 'diameter', label: 'Diameter (ft)' },
    { name: 'rings', label: 'Rings' },
    { name: 'driveHours', label: 'Drive Hours (1-way)' },
  ];

  const crewFields = [
    { name: 'labourers', label: 'Labourers ($24/hr)' },
    { name: 'foremen', label: 'Foremen ($40/hr)' },
  ];

  const checkboxFields = [
    { name: 'sidedraw', label: 'Sidedraw' },
    { name: 'stirator', label: 'Stirator' },
    { name: 'topDry', label: 'TopDry' },
    { name: 'daySweep', label: 'DaySweep' },
    { name: 'hopperBin', label: 'HopperBin' },
    { name: 'machineRental', label: 'Machine Rental ($250/day)' },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Full Job Quote</h2>
      <p className="text-sm text-slate-600 mb-4">Get a detailed cost breakdown including labor, hotel, diesel, and machine rental.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {numberFields.map(field => (
            <div key={field.name}>
              <label htmlFor={`quote-${field.name}`} className="block text-sm font-medium text-slate-600">{field.label}</label>
              <input
                type="number"
                name={field.name}
                id={`quote-${field.name}`}
                value={params[field.name as keyof typeof params] as number}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {crewFields.map(field => (
            <div key={field.name}>
              <label htmlFor={`quote-${field.name}`} className="block text-sm font-medium text-slate-600">{field.label}</label>
              <input
                type="number"
                name={field.name}
                id={`quote-${field.name}`}
                value={params[field.name as keyof typeof params] as number}
                onChange={handleChange}
                min={0}
                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-slate-600">Manufacturer</label>
            <select
              name="manufacturer"
              value={params.manufacturer}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="Brock">Brock</option>
              <option value="Westeel">Westeel</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600">Options</label>
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

        <div className="text-xs text-slate-500">
          Crew: {crewSize} total ({params.labourers} labourers + {params.foremen} foreman) • Billing rate: $60/hr per person • Hotel: {params.driveHours > 1.5 ? 'Yes' : 'No'} (triggered at &gt;1.5 hr drive)
        </div>

        <button onClick={handleQuote} className="w-full bg-slate-800 text-white font-semibold py-2 px-4 rounded-md hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition duration-150 ease-in-out">
          Generate Quote
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {quote && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-2xl font-bold text-slate-800">{quote.predictedHours.toFixed(0)}</p>
              <p className="text-xs text-slate-500">Predicted Man Hours</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-2xl font-bold text-slate-800">{quote.buildDays}</p>
              <p className="text-xs text-slate-500">Build Days</p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <h3 className="font-semibold text-slate-800 mb-3">Customer Quote</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Labor ({quote.predictedHours.toFixed(0)} hrs × $60/hr)</span>
                <span className="font-medium">{fmtMoney(quote.laborRevenue)}</span>
              </div>
              {quote.needsHotel && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Hotel ({quote.hotelRooms} rooms × {quote.hotelNights} nights × $160)</span>
                  <span className="font-medium">{fmtMoney(quote.hotelCost)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">Diesel ({quote.totalKm.toFixed(0)} km)</span>
                <span className="font-medium">{fmtMoney(quote.dieselCost)}</span>
              </div>
              {quote.machineCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Machine rental ({quote.buildDays} days × $250)</span>
                  <span className="font-medium">{fmtMoney(quote.machineCost)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-300">
                <span className="font-semibold text-slate-800">Total Quote</span>
                <span className="text-xl font-bold text-green-600">{fmtMoney(quote.totalQuote)}</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h3 className="font-semibold text-slate-800 mb-3">Internal Margin</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Crew wages (build)</span>
                <span className="font-medium">{fmtMoney(quote.internalLabor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Crew wages (drive time)</span>
                <span className="font-medium">{fmtMoney(quote.internalDriveLabor)}</span>
              </div>
              {quote.needsHotel && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Hotel</span>
                  <span className="font-medium">{fmtMoney(quote.hotelCost)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">Diesel</span>
                <span className="font-medium">{fmtMoney(quote.dieselCost)}</span>
              </div>
              {quote.machineCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Machine rental</span>
                  <span className="font-medium">{fmtMoney(quote.machineCost)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-amber-300">
                <span className="text-slate-600">Total internal cost</span>
                <span className="font-medium">{fmtMoney(quote.totalInternalCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-800">Gross Margin</span>
                <span className="text-lg font-bold text-amber-700">{fmtMoney(quote.grossMargin)} ({quote.marginPct.toFixed(1)}%)</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 italic">
            {quote.reasoning}
          </div>
        </div>
      )}
    </div>
  );
};

export default JobQuote;
