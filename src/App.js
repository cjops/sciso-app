import React, { useState, useEffect, createRef } from 'react';
import {max} from "d3-array";
import {json} from "d3-fetch";
import {select, selectAll} from "d3-selection"
import {scaleLinear, scalePoint, scaleSequential} from "d3-scale";
import {interpolateRound, interpolateLab} from "d3-interpolate";
import {axisTop} from "d3-axis"
import Tippy, {useSingleton} from '@tippyjs/react';
import {followCursor} from 'tippy.js';
import {GeneInput} from './GeneInput.js'
import {DatasetInput} from './DatasetInput.js'
import 'tippy.js/dist/tippy.css';
import './App.scss';

class GeneViz extends React.Component {
  constructor(props) {
    super(props);
    this.state = {data: null, loading: false};
  }
  componentDidUpdate(prevProps) {
    if (this.props.gene !== prevProps.gene) {
      this.setState({loading: true});
      json('/v2/gene?geneId=' + this.props.gene).then(data => {
        this.setState({data: data, loading: false});
      });
    }
  }
  render() {
    const loading = this.state.loading;
    const data = this.state.data;
    const datasets = this.props.datasets;
    if (loading) {
      return <span style={{color: 'red'}}>Spinner</span>
    } else if (data) {
      return <GeneVizFrame data={data} datasets={datasets} />
    } else {
      return null;
    }
  }
}

function GeneVizFrame(props) {
  const numCellTypes=16;
  const dims = {
    'bandWidth': 16,
    'paddingOuter': 40,
    'paddingInner': 5,
    'labelWidth': 120,
    'rectsWidth': 756,
    'paddingX': 10,
    'height': 1000,
    'bubblesAxisHeight': 25
  };
  //dims.bubblesWidth = (numCellTypes*dims.bandWidth)+((numCellTypes-1)*dims.bandWidth);
  dims.bubblesWidth = 400;
  dims.bubblesDiam = 20;
  dims.width = dims.labelWidth + dims.rectsWidth + dims.bubblesWidth + (dims.paddingX*2);
  const data = props.data;
  let modelExons = data.transcripts.filter(tx => tx.is_model)[0].exons;
  const [exonScale, intronScale] = setXscales(modelExons, dims.rectsWidth);
  modelExons.forEach((d, i) => {
    if (i == 0) {
        d.x = 0;
    } else {
        d.x = modelExons[i-1].x + modelExons[i-1].w + intronScale(d.intronLength);
    }
    d.w = exonScale(d.length);
  });
  const dsIDs = props.datasets.filter(ds => ds.isChecked).map(ds => ds.id);
  let visibleTranscripts = data.transcripts.filter(tx => tx.is_model || dsIDs.includes(tx.dataset_id));
  //const visibleTranscripts = data.transcripts.filter(tx => tx.is_model || dsIDs.includes(tx.dataset_id));
  const expression = visibleTranscripts.filter(tx => tx.attributes.expression).map(tx => tx.attributes.expression);
  visibleTranscripts.sort((a,b) => {
    return dsIDs.indexOf(a.dataset_id) - dsIDs.indexOf(b.dataset_id);
  });
  const expressionRadiusScale = scaleLinear()
    .domain([0, max(expression, e => max(e, e => e.pct_exp))])
    .range([1, dims.bubblesDiam/2])
    .interpolate(interpolateRound);
  const expressionColorScale = scaleSequential()
    .domain([-0.5 , 2.5])
    .interpolator(interpolateLab("lightgrey", "blue"));
  const expressionXScale = !expression[0] ? null : scalePoint()
    .domain(expression[0].map(d => d.cell_type))
    .range([0, dims.bubblesWidth - dims.bubblesDiam])
    .padding(0)
    .round(true);
  const transcriptElems = visibleTranscripts.map((transcript, i) =>
    <Transcript
      key={transcript.id}
      data={transcript}
      modelExons={modelExons}
      exonScale={exonScale}
      intronScale={intronScale}
      expressionRadiusScale={expressionRadiusScale}
      expressionColorScale={expressionColorScale}
      expressionXScale={expressionXScale}
      i={i}
      dims={dims}
      datasets={props.datasets.reduce((obj, item) => (obj[item.id] = item, obj) ,{})}
    />
  );
  useEffect(() => {
    if (expressionXScale && select('.GeneVizFrame svg .BubblesAxis').empty()) {
      select('.GeneVizFrame svg').append("g")
        .attr('class', 'BubblesAxis')
        .attr("transform", `translate(${dims.labelWidth+dims.rectsWidth+(dims.paddingX*2)},${dims.bubblesAxisHeight})`)
        .call(axisTop(expressionXScale))
        .call(g => g.select(".domain").remove())
        .call(g => g.selectAll("line").remove())
        .selectAll("text")
        .attr("y", 0)
        .attr("x", 9)
        .attr("dy", ".35em")
        .attr("transform", "rotate(90)")
        .style("text-anchor", "end");
    } else if (!expressionXScale) {
      select('.GeneVizFrame svg .BubblesAxis').remove();
    }
  });
  dims.height = dims.paddingOuter*2 + dims.bandWidth*visibleTranscripts.length + dims.paddingInner*(visibleTranscripts.length-1);
  return (
    <div className='GeneVizFrame my-3' style={{width: dims.width}}>
      <svg viewBox={`0 0 ${dims.width} ${dims.height}`} xmlns="http://www.w3.org/2000/svg">
        <style>{`
          text {
            font-family: sans-serif;
            font-size: 10px;
          }

          .ExonRect {
            fill: rgb(238, 238, 238);
            stroke: black;
            stroke-width: 1px;
            /*shape-rendering: crispEdges;*/
          }
                    
          .TranscriptID.reference {
            fill:seagreen;
          }
          
          .TranscriptID.novel {
            fill:steelblue;
          }
          
          .ExonRect.novel {
            fill:steelblue;
          }
          
          .ExonRect.reference {
            fill:seagreen;
          }
        `}</style>
        {transcriptElems}
      </svg>
    </div>
  );
}

function Transcript(props) {
  const [source, target] = useSingleton();
  const exonScale = props.exonScale;
  const intronScale = props.intronScale;
  const modelExons = props.modelExons;
  const transcriptID = props.data.annot_transcript_id;
  const dims=props.dims;
  const dataset = !props.data.is_model ? props.datasets[props.data.dataset_id] : {};
  const is_reference = dataset.is_reference;
  let exons = props.data.exons;
  // calculaing x and w of the rectangle for each curated exon on the final gene model
  exons.forEach((d, i) => {
    // first, map each final curated exon to the original full gene model--find the original exon
    // find the original exon
    d.oriExon = _findExon(d.chrom_start, modelExons)||_findExon(d.chrom_end, modelExons);
    if (d.oriExon === undefined) {
      // if not found
      console.warn(`${props.data.id}-${d.id} can't map to full gene model`);
      return; // ignore unmappable exons, this happens at times (why?)
    }

    // calculate for x
    if (Number(d.oriExon.chrom_start) == Number(d.chrom_start)) d.x = d.oriExon.x;
    else{
      // if this exon doesn't start from the oriExon start pos
      const dist = Number(d.chrom_start) - Number(d.oriExon.chrom_start) + 1;
      d.x = d.oriExon.x + exonScale(dist) - 2; // same as minExonWidth!
    }

    // calculate for w
    if (d.length === undefined) d.length = Number(d.chrom_end) - Number(d.chrom_start) + 1;
    d.w = exonScale(d.length);
  });
  const exonElems = exons.map((exon) =>
    <Exon key={exon.id} data={exon} target={target} dims={dims} is_reference={is_reference} />
  );
  return (
    <g
      className='Transcript'
      transform={`translate(0 ${dims.paddingOuter + (props.i * (dims.bandWidth+dims.paddingInner)) + 0.5})`}
    >
      <Tippy
        allowHTML={true}
        content={<span>Dataset: {dataset.name}<br />Transcript type: {props.data.attributes.transcript_type}<br />Source: {props.data.attributes.source}</span>}
        aria={null}
        trigger={'mouseenter'}
        hideOnClick={false}
        interactive={true}
        appendTo={document.body}
        followCursor={'horizontal'}
        plugins={[followCursor]}
      >
        <text
          className={`TranscriptID ${props.data.attributes.transcript_status == 'NOVEL' ? 'novel' : 'known'} ${is_reference ? 'reference' : 'non-reference'}`}
          textAnchor='end'
          dominantBaseline="middle"
          x={dims.labelWidth}
          y={dims.bandWidth/2}
        >
          {transcriptID}
        </text>
      </Tippy>
      <Tippy
        singleton={source}
        moveTransition='transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)'
        delay={[0, 500]}
      />
      <g
        className='ExonRects'
        transform={`translate(${dims.labelWidth+dims.paddingX+0.5})`}
      >
        <line
          x1={exons[0].x}
          x2={exons[exons.length - 1].x + exons[exons.length - 1].w}
          y1={dims.bandWidth/2}
          y2={dims.bandWidth/2}
          strokeWidth="1"
          stroke="black"
        ></line>
        {exonElems}
      </g>
      <ExpressionBubbles
        data={props.data}
        radiusScale={props.expressionRadiusScale}
        colorScale={props.expressionColorScale}
        xScale={props.expressionXScale}
        dims={dims}
      />
    </g>
  );
}

function ExpressionBubbles(props) {
  const expression = props.data.attributes.expression;
  const dims = props.dims;
  if (!expression) {
    return null;
  }
  const xScale = props.xScale;
  const radiusScale = props.radiusScale;
  const colorScale  = props.colorScale;
  const bubbles = expression.map((d, i) =>
    <Tippy
      allowHTML={true}
      content={<span>Pct expressed: {d.pct_exp}<br />Avg expression: {d.avg_exp_scaled}</span>}
      hideOnClick={false}
    >
      <circle
        className="ExpressionBubble"
        cx={xScale(d.cell_type)+0.5}
        cy={dims.bandWidth/2}
        r={radiusScale(d.pct_exp)}
        fill={colorScale(d.avg_exp_scaled)}
      ></circle>
    </Tippy>
  );
  return (
    <g
      className='ExpressionBubbles'
      transform={`translate(${dims.labelWidth+dims.rectsWidth+(dims.paddingX*2)}, 0)`}
    >
      {bubbles}
    </g>
  )
}

function Exon(props)
{
  const dims=props.dims;
  return (
    <Tippy
      content={`Exon ${props.data.exon_number}: ${props.data.chrom_start} - ${props.data.chrom_end} (${Number(props.data.chrom_end) - Number(props.data.chrom_start) + 1} bp)`}
      singleton={props.target}
    >
      <rect
        className={`ExonRect ${props.data.attributes.exon_status == 'NOVEL' ? 'novel' : ''} ${props.is_reference ? 'reference' : ''}`}
        x={props.data.x}
        y="0"
        width={props.data.w}
        height={dims.bandWidth}
      ></rect>
    </Tippy>
  );
}

function setXscales(exonIntervals, w=1000, minExonWidth=2, minIntronWidth=7) {
  exonIntervals.sort((a,b)=>{
    if (Number(a.chrom_start) < Number(b.chrom_start)) return -1;
    if (Number(a.chrom_start) > Number(b.chrom_start)) return 1;
    return 0;
  });

  let exonSum = 0;
  let intronSum = 0;
  exonIntervals.forEach((d, i)=>{
    d.length = Number(d.chrom_end) - Number(d.chrom_start) + 1;
    exonSum += d.length;
    if (i == 0) {
      d.intronLength = 0;
    } else {
      let nb = exonIntervals[i-1]; // the upstream neighbor exon
      d.intronLength = Number(d.chrom_start) - Number(nb.chrom_end) + 1;
    }
    intronSum += d.intronLength;
  });

  const exonDomain = [0, exonSum];
  const intronDomain = [0, intronSum];
  const exonRange = [0, w*.65 - (exonIntervals.length * minIntronWidth)];
  const intronRange = [0, (w * .35) - (exonIntervals.length * minExonWidth)];
  let exonScale = (val) => minExonWidth + scaleLinear()
    .domain(exonDomain)
    .range(exonRange)
    .interpolate(interpolateRound)
    .call(null, val);
  let intronScale = (val) => minIntronWidth + scaleLinear()
    .domain(intronDomain)
    .range(intronRange)
    .interpolate(interpolateRound)
    .call(null, val);
  return [exonScale, intronScale];
}

/**
 * For a given position, find the exon
 * @param pos {Integer}: a genomic position
 * @private
 */
function _findExon(pos, model_exons){
  pos = Number(pos);
  const results = model_exons.filter((d) => {return Number(d.chrom_start) - 1 <= pos && Number(d.chrom_end) + 1 >= pos});
  if (results.length == 1) return results[0];
  else if(results.length == 0) {
    console.warn("No exon found for: " + pos);
    return undefined;
  }
  else {
    console.warn("More than one exons found for: " + pos);
    return undefined;
  }
}

function saveSvg(svgEl, name) {
  svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  var svgData = svgEl.outerHTML;
  var preface = '<?xml version="1.0" standalone="no"?>\r\n';
  var svgBlob = new Blob([preface, svgData], {type:"image/svg+xml;charset=utf-8"});
  var svgUrl = URL.createObjectURL(svgBlob);
  var downloadLink = document.createElement("a");
  downloadLink.href = svgUrl;
  downloadLink.download = name;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {gene: '', datasets: []};
    this.handleGeneChange = this.handleGeneChange.bind(this);
    this.handleDatasetsChange = this.handleDatasetsChange.bind(this);
    this.downloadSVG = this.downloadSVG.bind(this);
    this.svgRef = createRef();
  }

  handleGeneChange(gene) {
    this.setState({gene});
  }

  handleDatasetsChange(datasets) {
    this.setState({datasets});
  }

  downloadSVG() {
    saveSvg(document.querySelector('.GeneVizFrame svg'), 'sciso');
  }

  render() {
    const gene = this.state.gene;
    const datasets = this.state.datasets;

    return (
      <div className="container-xxl">
        <div className="my-3">
          <h1>scISOseq Portal</h1>
        </div>
        <div className="row gy-3">
          <div className="col col-auto">
            <GeneInput
              gene={gene}
              onChange={this.handleGeneChange}
            />
          </div>
          <div className="col col-auto">
            <DatasetInput
              datasets={datasets}
              onChange={this.handleDatasetsChange}
            />
          </div>
          <div className="col col-auto">
            <button
              type="button"
              className="btn btn-light"
              onClick={this.downloadSVG}
            >
              Save SVG
            </button>
          </div>
        </div>
        <GeneViz
          gene={gene}
          datasets={datasets}
          svgRef={this.svgRef}
        />
      </div>
    )
  }
}

export default App;
