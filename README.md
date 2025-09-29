# Synthetic Data Generation Project

## Overview

This project implements a conversational AI application with two main functionalities:

1. Synthetic data generation
2. Natural language data querying

The project is divided into 3 phases, with Phase 1 focusing on data generation and Phases 2-3 on the conversational interface.

## Technical Stack

| Component        | Technology                           |
| ---------------- | ------------------------------------ |
| LLM              | Gemini 2.0 Flash (or newer)          |
| SDK              | Google GenAI SDK with Vertex AI Auth |
| UI               | Streamlit or Gradio                  |
| Database         | PostgreSQL                           |
| Containerization | Docker                               |
| Monitoring       | Langfuse for observability           |

### LLM Implementation Requirements

- Use streaming where appropriate
- Implement function calling
- Support JSON/structured output

## Project Phases

### Phase 1: Synthetic Data Generation

#### Features

- Generate consistent and valid data for provided DDL schema (supports 5-7 Tables)
- Handle various data constraints:
  - Data types
  - Null values
  - Date and time formats
  - Primary and foreign keys
- Allow user modification through textual feedback
- Support data export (CSV/ZIP archive)
- Store generated data for access in 'Talk to your data' tab

#### Sample DDL Schemas

- [library_mgm.ddl](https://drive.google.com/file/d/1oUDt5kSDj2QBn_Aqo2LbnbD4Oq7F0uIM/view?usp=sharing)
- [restaurants.ddl](https://drive.google.com/file/d/1SCKz6v39lXlOnDnPWaLlaTGIaCo0xhyF/view?usp=sharing)
- [company_employee.ddl](https://drive.google.com/file/d/19M3fEiRdgoxtaqaPIFP_iOAGUI0UzS0Z/view?usp=sharing)

## UI Requirements

### Layout

- Sidebar with main tabs:
  - Data Generation
  - Talk to your data

### Data Generation Tab Features

1. File Upload
   - Support for DDL schema files (.sql, .txt, .ddl)
2. Text Input
   - Text box for data generation instructions (prompt)
3. Configuration
   - Additional generation parameters (e.g., temperature)
4. Generation Control
   - "Generate" button to trigger data generation
5. Data Preview
   - View generated data for each table
6. Data Modification
   - Text prompt input for table modifications
   - Submit button to apply changes

## Implementation Notes

- Use Gemini access instructions for SDK setup
- Follow SQL generation tips for Gemini
- Ensure proper data consistency and validation
- Implement robust error handling
