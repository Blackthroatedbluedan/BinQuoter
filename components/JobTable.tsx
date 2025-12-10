import React from 'react';
import { Job, SortConfig } from '../types';

interface JobTableProps {
  jobs: Job[];
  requestSort: (key: keyof Job) => void;
  sortConfig: SortConfig;
  onDeleteJob: (id: string) => void;
}

const SortIndicator: React.FC<{ direction: 'ascending' | 'descending' }> = ({ direction }) => {
    return <span className="ml-2">{direction === 'ascending' ? '▲' : '▼'}</span>;
};

const JobTable: React.FC<JobTableProps> = ({ jobs, requestSort, sortConfig, onDeleteJob }) => {
    const headers: { key: keyof Job; label: string }[] = [
        { key: 'customer', label: 'Customer' },
        { key: 'diameter', label: 'Diameter (ft)' },
        { key: 'rings', label: 'Rings' },
        { key: 'bushels', label: 'Bushels (k)' },
        { key: 'crewSize', label: 'Crew' },
        { key: 'manHours', label: 'Man Hours' },
        { key: 'buildType', label: 'Build Type' },
    ];
    
  return (
    <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md overflow-x-auto">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Job History</h2>
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            {headers.map(header => (
                 // Fix: Cast `header.key` to string to resolve TypeScript error with React's `key` prop type.
                 <th key={header.key as string} scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <button onClick={() => requestSort(header.key)} className="flex items-center hover:text-slate-700">
                        {header.label}
                        {sortConfig?.key === header.key && <SortIndicator direction={sortConfig.direction} />}
                    </button>
                </th>
            ))}
            {/* Added a column for special features */}
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Features</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-slate-200">
          {jobs.map((job) => (
            <tr key={job.id} className="hover:bg-slate-50">
              <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{job.customer}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{job.diameter}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{job.rings}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{job.bushels.toLocaleString()}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{job.crewSize ?? 'N/A'}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-slate-600">{job.manHours}</td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{job.buildType}</td>
              <td className="px-4 py-4 whitespace-normal text-sm text-slate-500 max-w-xs">
                {[
                    job.sidedraw && 'Sidedraw',
                    job.stirator && 'Stirator',
                    job.topDry && 'TopDry',
                    job.daySweep && 'DaySweep',
                    job.hopperBin && 'HopperBin',
                ].filter(Boolean).join(', ')}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                <button
                  onClick={() => onDeleteJob(job.id)}
                  className="text-red-600 hover:text-red-800 transition-colors duration-150 ease-in-out"
                  aria-label={`Delete job for ${job.customer}`}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default JobTable;