import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line } from 'recharts';
import { Job } from '../types';

interface JobChartProps {
  jobs: Job[];
}

const JobChart: React.FC<JobChartProps> = ({ jobs }) => {
  const chartDataWithTrend = useMemo(() => {
    // Use only jobs with valid data points for regression
    const validJobs = jobs.filter(job => job.bushels > 0 && job.manHours > 0);

    if (validJobs.length < 2) {
      return validJobs;
    }
    
    const n = validJobs.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    validJobs.forEach(job => {
      const x = job.bushels;
      const y = job.manHours;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const denominator = (n * sumX2 - sumX * sumX);
    // If all x values are the same, denominator is 0, so we can't calculate a trendline.
    if (denominator === 0) {
        return validJobs;
    }
    
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return validJobs.map(job => ({
      ...job,
      // Trendline shouldn't predict negative hours.
      trendline: Math.max(0, slope * job.bushels + intercept),
    }));
  }, [jobs]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md h-96">
      <h2 className="text-xl font-bold mb-4 text-slate-800">Man Hours vs. Bin Capacity</h2>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{
            top: 20,
            right: 20,
            bottom: 40,
            left: 20,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            type="number" 
            dataKey="bushels" 
            name="Capacity" 
            unit="k bu" 
            angle={-30}
            textAnchor="end"
            label={{ value: 'Bin Capacity (Thousand Bushels)', position: 'insideBottom', offset: -25 }}
            tickFormatter={(tick) => tick.toLocaleString()}
            domain={['dataMin', 'dataMax']}
          />
          <YAxis 
            type="number" 
            dataKey="manHours" 
            name="Man Hours" 
            unit=" hrs"
            label={{ value: 'Man Hours', angle: -90, position: 'insideLeft', offset: 10 }}
            domain={['dataMin', 'dataMax']}
          />
          <Tooltip 
            cursor={{ strokeDasharray: '3 3' }} 
            content={({ active, payload }) => {
                if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                        <div className="bg-white border p-2 rounded shadow-lg text-sm">
                            <p className="font-bold">{data.customer}</p>
                            <p>Capacity: {data.bushels.toLocaleString()}k bu</p>
                            <p>Man Hours: {data.manHours} hrs</p>
                            <p>Crew: {data.crewSize ?? 'N/A'}</p>
                        </div>
                    )
                }
                return null;
            }}
          />
          <Legend verticalAlign="top" height={36}/>
          <Scatter name="Jobs" data={chartDataWithTrend} fill="#3b82f6" />
          {/* Render trendline only if it was calculated */}
          {chartDataWithTrend.length > 0 && 'trendline' in chartDataWithTrend[0] && (
             <Line 
                type="monotone"
                data={chartDataWithTrend}
                dataKey="trendline" 
                name="Trendline"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={false}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default JobChart;