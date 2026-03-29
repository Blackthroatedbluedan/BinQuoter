import React, { useState, useMemo, useEffect } from 'react';
import { Job, SortConfig } from './types';
import { JOBS } from './data';
import JobTable from './components/JobTable';
import JobChart from './components/JobChart';
import Prediction from './components/Prediction';
import BushelEstimator from './components/BushelEstimator';
import JobForm from './components/JobForm';
import CsvImporter from './components/CsvImporter';
import JobQuote from './components/JobQuote';
import { db } from './firebaseConfig';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, writeBatch, orderBy } from 'firebase/firestore';

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('customer', 'asc')); // Default sort by customer
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedJobs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];
      setJobs(fetchedJobs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching jobs: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const sortedJobs = useMemo(() => {
    let sortableJobs = [...jobs];
    if (sortConfig !== null) {
      sortableJobs.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableJobs;
  }, [jobs, sortConfig]);

  const requestSort = (key: keyof Job) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const handleAddJob = async (newJobData: Omit<Job, 'id'>) => {
    try {
      await addDoc(collection(db, 'jobs'), newJobData);
    } catch (e) {
      console.error("Error adding document: ", e);
      alert("Failed to add job to database.");
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (window.confirm('Are you sure you want to permanently delete this job entry?')) {
      try {
        await deleteDoc(doc(db, 'jobs', id));
      } catch (e) {
        console.error("Error deleting document: ", e);
        alert("Failed to delete job.");
      }
    }
  };

  const handleSeedData = async () => {
    if (!window.confirm("This will upload sample data to your database. Continue?")) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      JOBS.forEach(job => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...jobData } = job; // Exclude the static ID, let Firestore generate a new one
        const docRef = doc(collection(db, "jobs"));
        batch.set(docRef, jobData);
      });
      await batch.commit();
    } catch (e) {
      console.error("Error seeding data: ", e);
      alert("Failed to seed data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-100 min-h-screen font-sans">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-slate-900">Grain Bin Job Estimator</h1>
          <p className="mt-1 text-sm text-slate-500">Analyze past jobs and predict future project needs.</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BushelEstimator jobs={jobs} />
              <Prediction jobs={jobs} />
            </div>
            <JobQuote jobs={jobs} />
            <JobChart jobs={jobs} />
            
            {jobs.length === 0 ? (
              <div className="bg-white p-8 rounded-lg shadow-md text-center">
                <h3 className="text-lg font-medium text-slate-900 mb-2">Initialize Database</h3>
                <p className="text-slate-500 mb-4">Your Firestore database is currently empty.</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                      onClick={handleSeedData}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition shadow-lg font-medium"
                    >
                      Load Sample Data
                    </button>
                    {/* Importer is also available in the main layout, but this is a helpful shortcut */}
                </div>
              </div>
            ) : (
              <JobTable jobs={sortedJobs} requestSort={requestSort} sortConfig={sortConfig} onDeleteJob={handleDeleteJob} />
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <JobForm onAddJob={handleAddJob} />
                <CsvImporter />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
