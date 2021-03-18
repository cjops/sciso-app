import React, { useState, useEffect, useRef } from 'react';
import {json} from "d3-fetch";
import $ from 'jquery';
import 'selectize';

export function GeneInput(props) {
  const [geneNames, setGeneNames] = useState([]);
  const geneInput = useRef(null);
  
  function handleSubmit(event) {
    props.onChange(geneInput.current.value)
    event.preventDefault();
  }
  
  useEffect(() => {
    const fetchData = async () => {
      json('/v2/gene_names').then(data => {
        setGeneNames(data.genes);
      });
    };
    
    fetchData();
  }, []);
  
  useEffect(() => {
    const options = geneNames.map(gene => (
      {label: gene[1], value: gene[0]}
    ));
    var $geneInput = $(geneInput.current).selectize({
      mode: 'multi',
      maxItems: 1,
      valueField: 'label',
      labelField: 'label',
      searchField: 'label',
      options: options,
      create: false,
      closeAfterSelect: true,
      selectOnTab: true,
      maxOptions: 100,
      plugins: ['remove_button']
    });
    return function cleanup() {
      $geneInput[0].selectize.destroy();
    }; 
  }, [geneNames]);
  
  return (
    <div className="card bg-light" style={{"width": "18rem"}}>
      <div className="card-body">
        <h5 className="card-title">Enter a gene:</h5>
        <form className="row gx-3" onSubmit={handleSubmit}>
          <div className="col">
            <input type="text" className="form-control" ref={geneInput} defaultValue={props.gene} />
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary">Submit</button>
          </div>
        </form>
      </div>
    </div>
  );
}
    