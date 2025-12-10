import React, { useState } from 'react';
import { Job } from '../types';

interface JobFormProps {
    onAddJob: (job: Omit<Job, 'id'>) => void;
}

const initialFormState: Omit<Job, 'id'> = {
    customer: '',
    driveHours: 0,
    buildType: 'New',
    manufacturer: 'Brock',
    diameter: 0,
    rings: 0,
    bushels: 0,
    manHours: 0,
    crewSize: 0,
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
};

const JobForm: React.FC<JobFormProps> = ({ onAddJob }) => {
    const [jobData, setJobData] = useState(initialFormState);
    const [isOpen, setIsOpen] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        
        if (type === 'checkbox') {
            const { checked } = e.target as HTMLInputElement;
            setJobData(prev => ({...prev, [name]: checked}));
        } else if (type === 'number') {
            setJobData(prev => ({ ...prev, [name]: parseFloat(value) || null }));
        } else {
             // This handles select-one and text inputs
            setJobData(prev => ({ ...prev, [name]: value as any }));
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Automatically calculate bushels based on diameter and rings
        const { diameter, rings } = jobData;
        // Using an approximation based on existing data: bushels (k) = diameter^2 * rings * 0.0019
        const calculatedBushels = Math.round((diameter ** 2) * rings * 0.0019);

        onAddJob({ ...jobData, bushels: calculatedBushels });
        setJobData(initialFormState); // Reset form
        setIsOpen(false); // Close modal
    };

    const textFields = [
        { name: 'customer', label: 'Customer Name', type: 'text' },
    ];
    const numberFields = [
        { name: 'diameter', label: 'Diameter (ft)', type: 'number' },
        { name: 'rings', label: 'Rings', type: 'number' },
        { name: 'crewSize', label: 'Crew Size', type: 'number' },
        { name: 'manHours', label: 'Man Hours', type: 'number' },
        { name: 'driveHours', label: 'Drive Hours', type: 'number' },
    ];
     const checkboxFields = [
        { name: 'sidedraw', label: 'Sidedraw' },
        { name: 'stirator', label: 'Stirator' },
        { name: 'topDry', label: 'TopDry' },
        { name: 'daySweep', label: 'DaySweep' },
        { name: 'hopperBin', label: 'HopperBin' },
    ];

    if (!isOpen) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-md text-center">
                <h2 className="text-xl font-bold mb-4 text-slate-800">Add New Job</h2>
                <button onClick={() => setIsOpen(true)} className="w-full bg-slate-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition duration-150 ease-in-out">
                    Add Job Entry
                </button>
            </div>
        );
    }
    
    return (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">Add New Job Entry</h2>
                    <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-slate-700 text-2xl leading-none">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {textFields.map(field => (
                         <div key={field.name}>
                            <label htmlFor={field.name} className="block text-sm font-medium text-slate-600">{field.label}</label>
                            <input 
                                type={field.type}
                                name={field.name}
                                id={field.name}
                                value={jobData[field.name as keyof typeof jobData] as string}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                required 
                            />
                        </div>
                    ))}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {numberFields.map(field => (
                            <div key={field.name}>
                                <label htmlFor={field.name} className="block text-sm font-medium text-slate-600">{field.label}</label>
                                <input
                                    type={field.type}
                                    name={field.name}
                                    id={field.name}
                                    // FIX: Cast the value to `number | null` to inform TypeScript that a boolean is not expected here, resolving the type error for the input's `value` prop.
                                    value={(jobData[field.name as keyof Omit<Job, 'id'>] as number | null) ?? ''}
                                    onChange={handleChange}
                                    className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    required
                                    step="any"
                                />
                            </div>
                        ))}
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-600">Build Type</label>
                        <select name="buildType" value={jobData.buildType} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
                            <option value="New">New</option>
                            <option value="Extension">Extension</option>
                            <option value="Old">Old</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Manufacturer</label>
                        <select name="manufacturer" value={jobData.manufacturer} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
                            <option value="Brock">Brock</option>
                            <option value="Westeel">Westeel</option>
                            <option value="GenericCorp">GenericCorp</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Features</label>
                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                             {checkboxFields.map(field => (
                                <label key={field.name} className="flex items-center space-x-2 text-sm">
                                    <input 
                                        type="checkbox" 
                                        name={field.name}
                                        checked={jobData[field.name as keyof Omit<Job, 'id'>] as boolean}
                                        onChange={handleChange} 
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                                    />
                                    <span>{field.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="flex justify-end space-x-2 pt-2">
                         <button type="button" onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500">
                            Cancel
                        </button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                            Add Job
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default JobForm;
