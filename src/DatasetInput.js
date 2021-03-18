import React, { useState, useEffect, useRef } from 'react';
import {json} from "d3-fetch";

export function DatasetInput(props) {

  useEffect(() => {
    const fetchData = async () => {
      json('/v2/dataset').then(data => {
        let newDatasets = data.datasets.map((dataset) => {
          dataset.isChecked = true;
          return dataset;
        });
        const referenceDatasets = newDatasets.filter(dataset => dataset.is_reference);
        newDatasets = newDatasets.filter(dataset => !dataset.is_reference);
        newDatasets.unshift(...referenceDatasets);
        props.onChange(newDatasets);
      });
    };
    fetchData();
  }, []);
  
  function handleInputChange(i) {
    const datasets = props.datasets;
    datasets[i].isChecked = !datasets[i].isChecked;
    props.onChange(datasets)
  }

  const datasetChecks = props.datasets.map((dataset, i) =>
    <DatasetCheckbox dataset={dataset} i={i} key={dataset.id} onChange={() => handleInputChange(i)} />
  );

  return (
    <div>
      <h5>Datasets</h5>
      <form>
        {datasetChecks}
      </form>
    </div>
  );
}
  
function DatasetCheckbox(props) {
  const dataset = props.dataset;
  return (
    <div className="form-check form-switch">
      <input
        className="form-check-input"
        type="checkbox"
        name={dataset.name}
        checked={dataset.isChecked}
        onChange={props.onChange}
      />
      <label className="form-check-label">{dataset.name}</label>
    </div>
  );
}