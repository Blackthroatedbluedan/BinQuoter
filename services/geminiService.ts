
import { GoogleGenAI, Type } from "@google/genai";
import { Job, RecommendationParams, BinRecommendation, PredictionParams, ManHourPrediction } from '../types';

// FIX: Initialize the GoogleGenAI client.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const jobToText = (job: Job) => {
  const features = [
    job.sidedraw && 'sidedraw',
    job.stirator && 'stirator',
    job.topDry && 'topDry',
    job.daySweep && 'daySweep',
    job.hopperBin && 'hopperBin',
  ].filter(Boolean).join(', ');
  return `Diameter: ${job.diameter}ft, Rings: ${job.rings}, Bushels: ${job.bushels}k, Crew: ${job.crewSize}, Drive Hours: ${job.driveHours ?? 'N/A'}, Features: [${features || 'none'}], Man Hours: ${job.manHours}`;
};


export const getBinRecommendation = async (jobs: Job[], params: RecommendationParams): Promise<BinRecommendation> => {
  // FIX: Use a recommended model.
  const model = "gemini-2.5-flash";

  const prompt = `You are an expert grain bin construction estimator. 
  Based on the historical job data, recommend a grain bin configuration and predict the man-hours for a new job.
  
  Historical Data (subset for context):
  ${jobs.slice(0, 20).map(job => `- ${jobToText(job)}`).join('\n')}

  New Job Requirements:
  - Desired Capacity: at least ${params.desiredBushels}k bushels
  - Sidedraw: ${params.sidedraw}
  - Stirator: ${params.stirator}
  - TopDry: ${params.topDry}
  - DaySweep: ${params.daySweep}
  - HopperBin: ${params.hopperBin}

  Analyze the historical data to find jobs with similar capacity and features. Based on this analysis, recommend the most suitable standard bin size (diameter and rings) that meets or exceeds the desired capacity and predict the total man-hours required. Provide a brief reasoning for your choice.
  `;

  // FIX: Define a response schema for structured output.
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      recommendedDiameter: { type: Type.NUMBER, description: "Recommended bin diameter in feet." },
      recommendedRings: { type: Type.NUMBER, description: "Recommended number of rings for the bin." },
      predictedHours: { type: Type.NUMBER, description: "Predicted total man-hours for the job." },
      reasoning: { type: Type.STRING, description: "Brief explanation for the recommendation." }
    },
    required: ["recommendedDiameter", "recommendedRings", "predictedHours", "reasoning"]
  };

  // FIX: Call the Gemini API to generate content.
  const response = await ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0.2,
    }
  });

  const jsonText = response.text.trim();
  try {
    return JSON.parse(jsonText) as BinRecommendation;
  } catch (e) {
    console.error("Failed to parse Gemini response:", jsonText, e);
    throw new Error("The model returned an invalid response.");
  }
};


export const getManHourPrediction = async (jobs: Job[], params: PredictionParams): Promise<ManHourPrediction> => {
  // FIX: Use a recommended model.
  const model = "gemini-2.5-flash";

  const prompt = `You are an AI assistant that predicts labor hours for grain bin construction projects.
  Based on the provided historical job data, predict the man-hours required for a new job with the specified parameters.

  Historical Data (subset for context):
  ${jobs.slice(0, 20).map(job => `- ${jobToText(job)}`).join('\n')}

  New Job Parameters:
  - Diameter: ${params.diameter} ft
  - Rings: ${params.rings}
  - Crew Size: ${params.crewSize}
  - Drive Hours: ${params.driveHours}
  - Sidedraw: ${params.sidedraw}
  - Stirator: ${params.stirator}
  - TopDry: ${params.topDry}
  - DaySweep: ${params.daySweep}
  - HopperBin: ${params.hopperBin}
  
  Analyze the historical data for jobs with similar dimensions and features, including drive time. Provide a man-hour prediction and a brief explanation of the factors that influenced your prediction. Note that man-hours for the build should not include drive time, but drive time can be a factor in overall project fatigue or logistics that might indirectly affect build time.
  `;

  // FIX: Define a response schema for structured output.
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      predictedHours: { type: Type.NUMBER, description: "Predicted total man-hours for the new job." },
      reasoning: { type: Type.STRING, description: "Brief explanation of the factors influencing the prediction." }
    },
    required: ["predictedHours", "reasoning"]
  };

  // FIX: Call the Gemini API to generate content.
  const response = await ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0.2,
    },
  });

  const jsonText = response.text.trim();
  try {
    return JSON.parse(jsonText) as ManHourPrediction;
  } catch (e) {
    console.error("Failed to parse Gemini response:", jsonText, e);
    throw new Error("The model returned an invalid response.");
  }
};