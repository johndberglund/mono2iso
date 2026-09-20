var tileLength ; // how many edge segments per tile - allow 6 + n
var mySums = [];

// these three arrays are always the same
// for transitive maps - edge to edge to edge
var mapping = [
    [ 0,1,2,3 ],
    [ 1,0,3,2 ],
    [ 2,3,0,1 ],
    [ 3,2,1,0 ]
  ];

// to combine mappings to find symmetry
var edgeSymmetry = [
    [ 0,1,2,3 ],
    [ 1,1,2,2 ],
    [ 2,2,2,2 ],
    [ 3,2,2,3 ]
  ];

// to find the lowest equivalent mapping in that symmetry
var symmetryToMap = [
    [ 0,1,2,3 ],  
    [ 0,0,2,2 ],
    [ 0,0,0,0 ],
    [ 0,1,1,0 ]
  ];

var allPrint;
var orientation, offset;
  //will fill in these arrays partially up to the counter, repeating through all possible
var sum =   [];  // how many of that netEdgeGrow
var first = [];  // partial sum of length of first polygon
var second = []; // partial sum of length of second polygon
var repeat = new Array(maxCounter).fill(0); // 0 = repeat, 1 = stop this iteration

var counter, currentSum;
var toPrint;
var forTextFile;
// specify()'s per-polygon-edge result -- 0:edge symmetry, 1:congruent-to edge (whichEdge),
// 2:mapping code, 3-8:working rows, 9:resulting edge, 10:resulting edge map. Exposed at
// module scope (not `var`-redeclared inside specify()) so callers can read it directly
// instead of round-tripping through forTextFile's "Edge Sym"/"Which Edge"/"Mapping" text and
// parsing it back out with a regex.
var tileEdges;
// vertexAngle[i] from specify()'s reducibility check: 1 if position i is a genuine
// combinatorial vertex, 0 if it's a redundant/reducible position -- structural, independent
// of the solved numeric angle there. Exposed the same way as tileEdges. Mirrors aniso_fast.js.
var reducibleVertex;
// The final, sorted `tileAngles` matrix -- see aniso_fast.js's matching comment. Mirrors it.
var tileAnglesOut;

function init() {
 //  getType(); // in allTypes.js
   allPrint = 0; // 0 means don't Print all. 1 means Print all.

    // we can either specify one tiling or cycle through many
    if (document.getElementById("findAll").checked) {
      cycle();
      txtToFile(forTextFile,"anisoTile","txt");
    } else {
      specify();
      alert(forTextFile);
    }
  }

function setTileType() {
  getType();
  var biggestPoly = Math.max(firstPolygonSize, secondPolygonSize);
  document.getElementById("tileLeng").value=biggestPoly;
  document.getElementById("tileLeng").min=biggestPoly;
  setTileLeng();
}

function setSumType() {
  sum = JSON.parse(document.getElementById("sumType").value);
}

function setTileLeng() {
//  getType();
  tileLength = parseInt(document.getElementById("tileLeng").value);
  findSumWays();
  sum = mySums[0];
  document.getElementById("offset").max = tileLength-1;
  document.getElementById("offset").value = 0;
  document.getElementById("orient").checked = false;
//alert(JSON.stringify(sum));
  reloadSums();
}

function reloadSums() {
  var mySelect = document.getElementById("sumType");
  while (mySelect.firstChild) {
    mySelect.removeChild(mySelect.firstChild);
  }  
//alert(JSON.stringify(mySums));
  mySums.forEach(function(nextSum) {
    var newOption = document.createElement("option");
    newOption.value = JSON.stringify(nextSum);
    newOption.text = JSON.stringify(nextSum);
    mySelect.appendChild(newOption);
  }); // end mySums loop
}

function cycle() {
  forTextFile = "Name: "+tileName+"\r\n";
  findSumWays();
  mySums.forEach(function(nextSum) {
    sum = nextSum;
    // sets the size row of netEdgeData by adding sum values from netEdgeGrow
    for (counter2 = 0; counter2 < netEdgesSum; counter2++) {
      currentSum = 0;
      for (sizeCounter = 0;
           sizeCounter < maxCounter; sizeCounter++) {
        currentSum = currentSum +
         netEdgeGrow[sizeCounter][counter2]*sum[sizeCounter];
      }
      netEdgeData [4][counter2] = currentSum;
    }
     // sets the beginAt row of netEdgeData for the first polygon
    for (counter2 = 1; counter2 < firstPolygonSize; counter2++) {
      netEdgeData[5][counter2] = (netEdgeData[5][counter2-1]+
                                 netEdgeData [4][counter2-1]);
    }
    for (orientation = 0; orientation < 2; orientation++) {
      // set netEdgeData orientation and stepsize
      for (counter2 = firstPolygonSize; counter2 < netEdgesSum ; counter2++) {
        netEdgeData[6][counter2] = orientation;
        netEdgeData[7][counter2] = 1-2*orientation;
      }     
      //change the size row of netEdgeData for 2nd polygon if needed
      if (orientation === 1) {
        for (counter2 = firstPolygonSize;
             counter2 < netEdgesSum ; counter2++) {
          netEdgeData [4][counter2] = -1*netEdgeData [4][counter2];
        }
      }
      for (offset = 0; offset < tileLength; offset++) {
        // sets the beginAt row of netEdgeData for 2nd polygon
        // we must add tileLength to ensure is positive after MOD
        // the zero vertex is the base to measure from
        netEdgeData[5][firstPolygonSize] =
         (offset-orientation+tileLength)%tileLength;
        for (counter2 = firstPolygonSize+1;
             counter2 < netEdgesSum ; counter2++) {
          netEdgeData[5][counter2] = (netEdgeData[5][counter2-1]+
          netEdgeData [4][counter2-1]+tileLength) % tileLength;
        } 
        adjacentSetUp();  // should cycle through all possiblities   
      } // end offset loop
    } // end orientation loop
  }); // end mySums loop
  forTextFile +="the end";
} // end cycle()

function findSumWays() {
  //will fill in these arrays partially up to the counter, repeating through all possible
  sum =   [];  // how many of that netEdgeGrow
  first = [];  // partial sum of length of first polygon
  second = []; // partial sum of length of second polygon
  repeat = new Array(maxCounter).fill(0); // 0 = repeat, 1 = stop this iteration

  mySums = [];
  tileLength = parseInt(document.getElementById("tileLeng").value);
  sum[0] = 1;
  first[0]=firstPolygonSize;
  second[0]=secondPolygonSize;
  counter=1;
  sum[1] = 0;
  while (counter > 0) {
    first[counter] = first[counter-1] +
                     sum[counter]*netEdgeGrow [counter][netEdgesSum];
    second[counter] = second[counter-1] +
                      sum[counter]*netEdgeGrow [counter][netEdgesSum+1];
    if (first[counter] > tileLength) {repeat[counter] = 1;}
    if (second[counter] > tileLength) {repeat[counter] = 1;}
    while (repeat[counter] < 1) {
      counter++;
      repeat[counter]=0;
      sum[counter] = 0;
      // this sets the final amount exact for one polygon
      if (counter === maxCounter-1) {
        // need both these ifs to avoid dividing by zero
        if ( netEdgeGrow [counter][netEdgesSum] === 0) 
          {sum[counter] = (tileLength-second[counter-1])/
                        netEdgeGrow [counter][netEdgesSum+1];}
        else
          {sum[counter] = (tileLength-first[counter-1])/
                        netEdgeGrow [counter][netEdgesSum];}
        first[counter] = first[counter-1]+
                         sum[counter]*netEdgeGrow [counter][netEdgesSum];
        second[counter] = second[counter-1] +
                          sum[counter]*netEdgeGrow [counter][netEdgesSum+1];
        // This last multiplicity is SOLVED for by the division above, not enumerated, so
        // it is only a real sum-type when the division came out exact: sum[counter] counts
        // how many of a netEdgeGrow row, and there is no half a net edge.  Without this
        // guard a fractional value whose totals still land on tileLength was pushed --
        // e.g. #188 at m=4 gave [1,0,0,0,0.5].  It also rejects the NaN/Infinity from a
        // 0/0 division when this row contributes to neither polygon.
        // Callers must be able to trust mySums; do not push a fraction and filter later.
        if ((first[counter] === tileLength) &&
            (second[counter] === tileLength) &&
            Number.isInteger(sum[counter]) && sum[counter] >= 0) {
            mySums.push(JSON.parse(JSON.stringify(sum)));
        } // end both first and second === tileLength
        counter--;    
        sum[counter]++;
      } // end if counter === maxcounter-1
      first[counter] = first[counter-1]+
                       sum[counter]*netEdgeGrow [counter][netEdgesSum];
      second[counter] = second[counter-1] +
                        sum[counter]*netEdgeGrow [counter][netEdgesSum+1];
      if (first[counter] > tileLength) {repeat[counter] = 1;}
      if (second[counter] > tileLength) {repeat[counter] = 1;}
    } // end while (repeat[counter] < 1)
    counter--;
    sum[counter]++;
  } // end while counter>0
} // end findSumWays


function specify() {
  tileLength = parseInt(document.getElementById("tileLeng").value);
  offset = parseInt(document.getElementById("offset").value);
  orientation = 0;
  if (document.getElementById("orient").checked) {orientation = 1;}
  sum = JSON.parse(document.getElementById("sumType").value);

  forTextFile= "";
          
  // sets the size row of netEdgeData by adding sum values from netEdgeGrow
  for (counter2 = 0; counter2 < netEdgesSum; counter2++) {
    currentSum = 0;
    for (sizeCounter = 0;
         sizeCounter < maxCounter; sizeCounter++) {
      currentSum = currentSum +
           netEdgeGrow[sizeCounter][counter2]*sum[sizeCounter];
    }
    netEdgeData [4][counter2] = currentSum;
  }

  // should check if  same size polygons
        
  // sets the beginAt row of netEdgeData for the first polygon
  for (counter2 = 1; counter2 < firstPolygonSize; counter2++) {
    netEdgeData[5][counter2] = (netEdgeData[5][counter2-1]+
    netEdgeData [4][counter2-1]);
  }

  // set netEdgeData orientation and stepsize
  for (counter2 = firstPolygonSize; counter2 < netEdgesSum ; counter2++) {
    netEdgeData[6][counter2] = orientation;
    netEdgeData[7][counter2] = 1-2*orientation;
  }

  //change the size row of netEdgeData for 2nd polygon if needed
  if (orientation === 1) {
    for (counter2 = firstPolygonSize;
         counter2 < netEdgesSum ; counter2++) {
      netEdgeData [4][counter2] = -1*netEdgeData [4][counter2];
    }
  }

  // sets the beginAt row of netEdgeData for 2nd polygon
  // we must add tileLength to ensure is positive after MOD
  // the zero vertex is the base to measure from
  netEdgeData[5][firstPolygonSize] =
      (offset-orientation+tileLength)%tileLength;
  for (counter2 = firstPolygonSize+1;
        counter2 < netEdgesSum ; counter2++) {
    netEdgeData[5][counter2] = (netEdgeData[5][counter2-1]+
       netEdgeData [4][counter2-1]+tileLength) % tileLength;
  }

  // Print ID information
  forTextFile += "Name: "+tileName+"\r\n";
  forTextFile += "sum: ";
  for (i = 0; i<maxCounter;i++) {
    forTextFile += " "+sum[i];
  }
  forTextFile += "\r\n";
  adjacentSetUp();  // should Print the one specific example.
} // end specify()


function adjacentSetUp () {
    forTextFile += "sum: ";
    for (i = 0; i<maxCounter;i++) {
      forTextFile += " "+sum[i];
    }
    forTextFile += "\r\n";
    forTextFile += "orient: " + orientation + " offset: " + offset + "\r\n";
    
    if (allPrint === 1) {
      // Print ID information (again...)
      forTextFile += "Name: "+tileName + "\r\n";
      forTextFile += "sum: ";
      for (i = 0; i<maxCounter;i++) {
        forTextFile += " "+sum[i];
      }
      forTextFile += "\r\n";
      
      // Print net data.
      forTextFile += "NetEdgeData" + "\r\n";
      for ( i = 0;i<8;i++) {
        for ( j = 0;j<netEdgesSum;j++) {
          forTextFile += "."+netEdgeData[i][j];
        }
      forTextFile += "\r\n";
      } // end net data
    
      forTextFile += "NetAngles" + "\r\n";
      for ( i = 0;i<netAngles.length;i++) {
        for ( j = 0;j<netEdgesSum+1;j++) {
          forTextFile += "/"+netAngles[i][j];
        }
      forTextFile += "\r\n";
      } //end net angles
      
      forTextFile += "NetEdgeGrow" + "\r\n";
      for ( i = 0;i<netEdgeGrow.length;i++) {
        for ( j = 0;j<netEdgesSum+2;j++) {
          forTextFile += "."+netEdgeGrow[i][j];
        }
      forTextFile += "\r\n";
      } // end net edge grow
    } // end allPrint

// 0-edge symmetry, 1-first edge tile sym., 2-first edge tile sym. map
// 3-second edge tile sym., 4-second edge tile sym. map, 5-first tile adj.
// 6-first tile adj. map, 7-second tile adj., 8-second tile adj. map
// 9-resulting edge, 10-resulting edge map (both init to self)
    tileEdges = Array(11);
    for (i=0;i<11;i++) {
      tileEdges[i] = Array(tileLength).fill(0);
    }

// the second array index holds the angles followed by the sum in degrees
    var angleArraySize = netAngles.length+2*(tileLength*2-netEdgesSum);
    var tileAngles = Array(angleArraySize);
    for (i=0;i<angleArraySize;i++) {
      tileAngles[i] = Array(tileLength+1).fill(0);
    }
    // put netAngles in tileAngles
    for (i = 0; i< netAngles.length;i++) {
      // to make sure that all is zero to start.
      for (j = 0; j<tileLength;j++) {
        tileAngles [i][j] = 0;
      }
      for (j =0; j< netEdgesSum;j++) {
        var nowAngle = (netEdgeData [5][j]+
                        netEdgeData[6][j]+tileLength)%tileLength;
        tileAngles [i][nowAngle]=
                           tileAngles [i][nowAngle]+netAngles[i][j];
      }
      // set the sum in degrees
      tileAngles [i][tileLength]=netAngles [i][netEdgesSum];
    }
     
    var angleCounter = netAngles.length;

    // first edge tile sym
    for ( i = 0;i<firstPolygonSize;i++) {
      var orient1 = netEdgeData [6][i];
      var edge2 = netEdgeData[0][i];
      var map2 = netEdgeData [1][i];
      var orient2 = netEdgeData [6][edge2];
      var sameOriented =mapping[orient1][orient2];
      var newMap = mapping [sameOriented] [map2];
      var size = Math.abs(netEdgeData[4][i]);

      if (size > 1) {
        var begin1 = netEdgeData[5][i];
        var begin2 = netEdgeData[5][edge2];
        var step1 = netEdgeData[7][i];
        var step2 = netEdgeData[7][edge2];

        if (map2===1 || map2 ===3) {
            begin2 = (begin2 + (size-1)*step2 + tileLength)%tileLength;
            step2 = -1*step2;
        }

        for ( i2 = 0; i2 < size; i2++) {
            if (i2 != size-1) {
                // we use ++, -- in case they are the same
                // (step# +1)/2 gives the larger of the two.
                tileAngles[angleCounter][(begin1+(step1+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][(begin2+(step2+1)/2+tileLength)%tileLength]--;
//  tileAngles[angleCounter][tileLength]=0;
                angleCounter++;
            }

            tileEdges[1][begin1] = begin2;
            tileEdges[2][begin1] = newMap;
            begin1 = (begin1 + step1 + tileLength)%tileLength;
            begin2 = (begin2 + step2 + tileLength)%tileLength;

        }
      } // end size > 1
      if (size === 1) {
          var begin1 = netEdgeData[5][i];
          tileEdges[1][begin1]= netEdgeData[5][edge2];
          tileEdges[2][begin1]= newMap;
      } // end size = 1     
    } //end first edge tile sym.

    // second edge tile sym
    for ( i = firstPolygonSize;i<netEdgesSum;i++) {
      var orient1 = netEdgeData [6][i];
      var edge2 = netEdgeData[0][i];
      var map2 = netEdgeData [1][i];
      var orient2 = netEdgeData [6][edge2];
      var sameOriented =mapping[orient1][orient2];
      var newMap = mapping [sameOriented] [map2];
      var size = Math.abs(netEdgeData[4][i]);
      if (size > 1) {
        var begin1 = netEdgeData[5][i];
        var begin2 = netEdgeData[5][edge2];
        var step1 = netEdgeData[7][i];
        var step2 = netEdgeData[7][edge2];
        if (map2===1 || map2 ===3) {
            begin2 = (begin2 + (size-1)*step2 + tileLength)%tileLength;
            step2 = -1*step2;
        }
        for ( i2 = 0; i2 < size; i2++) {
            // for internal angles of segment
            if (i2 != size-1) {
                // we use ++, -- in case they are the same
                // (step# +1)/2 gives the larger of the two.
                tileAngles[angleCounter][(begin1+(step1+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][(begin2+(step2+1)/2+tileLength)%tileLength]--;
//  tileAngles[angleCounter][tileLength]=0;
                angleCounter++;
            }
            tileEdges[3][begin1] = begin2;
            tileEdges[4][begin1] = newMap;
            begin1 = (begin1 + step1 + tileLength)%tileLength;
            begin2 = (begin2 + step2 + tileLength)%tileLength;
        }
      } // end size > 1
      if (size === 1) {
          var begin1 = netEdgeData[5][i];
          tileEdges[3][begin1]= netEdgeData[5][edge2];
          tileEdges[4][begin1]= newMap;
      } // end size = 1     
    } //end second edge tile sym.

    // first adj sym
    for ( i = 0;i<firstPolygonSize;i++) {
      var orient1 = netEdgeData [6][i];
      var edge2 = netEdgeData[2][i];
      var map2 = netEdgeData [3][i];
      var orient2 = netEdgeData [6][edge2];
      var sameOriented =mapping[orient1][orient2];
      var newMap = mapping [sameOriented] [map2];
      var size = Math.abs(netEdgeData[4][i]);
      if (size > 1) {
        var begin1 = netEdgeData[5][i];
        var begin2 = netEdgeData[5][edge2];
        var step1 = netEdgeData[7][i];
        var step2 = netEdgeData[7][edge2];
        if (map2===1 || map2 ===3) {
            begin2 = (begin2 + (size-1)*step2 + tileLength)%tileLength;
            step2 = -1*step2;
        }
        for ( i2 = 0; i2 < size; i2++) {
            if (i2 != size-1) {
                // we use ++, -- in case they are the same
                // (step# +1)/2 gives the larger of the two.
                tileAngles[angleCounter][(begin1+(step1+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][(begin2+(step2+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][tileLength]=360;
                angleCounter++;
            }
            tileEdges[5][begin1] = begin2;
            tileEdges[6][begin1] = newMap;
            begin1 = (begin1 + step1 + tileLength)%tileLength;
            begin2 = (begin2 + step2 + tileLength)%tileLength;
        }
      } // end size > 1
      if (size === 1) {
          var begin1 = netEdgeData[5][i];
          tileEdges[5][begin1]= netEdgeData[5][edge2];
          tileEdges[6][begin1]= newMap;
      } // end size = 1      
    } //end first adj. sym.

    // second adj sym
    for ( i = firstPolygonSize;i<netEdgesSum;i++) {
      var orient1 = netEdgeData [6][i];
      var edge2 = netEdgeData[2][i];
      var map2 = netEdgeData [3][i];
      var orient2 = netEdgeData [6][edge2];
      var sameOriented =mapping[orient1][orient2];
      var newMap = mapping [sameOriented] [map2];
      var size = Math.abs(netEdgeData[4][i]);
      if (size > 1) {
        var begin1 = netEdgeData[5][i];
        var begin2 = netEdgeData[5][edge2];
        var step1 = netEdgeData[7][i];
        var step2 = netEdgeData[7][edge2];
        if (map2===1 || map2 ===3) {
            begin2 = (begin2 + (size-1)*step2 + tileLength)%tileLength;
            step2 = -1*step2;
        }
        for ( i2 = 0; i2 < size; i2++) {
            if (i2 != size-1) {
                // we use ++, -- in case they are the same
                // (step# +1)/2 gives the larger of the two.
                tileAngles[angleCounter][(begin1+(step1+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][(begin2+(step2+1)/2+tileLength)%tileLength]++;
                tileAngles[angleCounter][tileLength]=360;
                angleCounter++;
            }
            tileEdges[7][begin1] = begin2;
            tileEdges[8][begin1] = newMap;
            begin1 = (begin1 + step1 + tileLength)%tileLength;
            begin2 = (begin2 + step2 + tileLength)%tileLength;
        }
      } // end size > 1
      if (size === 1) {
          var begin1 = netEdgeData[5][i];
          tileEdges[7][begin1]= netEdgeData[5][edge2];
          tileEdges[8][begin1]= newMap;
      } // end size = 1
    } //end second adj. sym.

    // to set all symmetry to 0 to start and all maps to self
    for ( i = 0;i<tileLength;i++) {
        tileEdges[0][i] = 0;
        tileEdges[9][i] = i; 
        tileEdges[10][i] = 0;
    } // end set all to self to start.

    if (allPrint === 1) {
      // Print tileEdges[][]
      forTextFile += "tileEdges" + "\r\n";
      toPrint = "";
      for ( i = 0;i<11;i++) {
        for ( j = 0;j<tileLength;j++) {
          forTextFile += "."+tileEdges[i][j];
        }
      forTextFile += "\r\n";
      }    
    } // end allPrint
  
    
// to set all maps to the lowest neighbor
// go through all pairs that are mapped. change the higher one to the lower.

   var minNeighbor=0, maxNeighbor=0;
   for ( i = 0; i < tileLength; i++) {
     for ( j = 1; j < 8; j = j + 2) {
       if (tileEdges[j][i] > tileEdges[j+2][i]) {
         minNeighbor = tileEdges[j+2][i];
         maxNeighbor = tileEdges[j][i];
       }
       else {
         minNeighbor = tileEdges[j][i];
         maxNeighbor = tileEdges[j+2][i];
       }
       var reMap = mapping[tileEdges[j+1][i]][tileEdges[j+3][i]];
       // changes all instances of MaxNeighbor to minNeighbor
       for ( i2 = 0;i2<tileLength;i2++) {
         if (tileEdges[1][i2]===maxNeighbor) {
           tileEdges[1][i2] = minNeighbor;
           tileEdges[2][i2] = mapping[tileEdges[2][i2]][reMap];
         }
         if (tileEdges[3][i2]===maxNeighbor) {
           tileEdges[3][i2] = minNeighbor;
           tileEdges[4][i2] = mapping[tileEdges[4][i2]][reMap];
         }
         if (tileEdges[5][i2]===maxNeighbor) {
           tileEdges[5][i2] = minNeighbor;
           tileEdges[6][i2] = mapping[tileEdges[6][i2]][reMap];
         }
         if (tileEdges[7][i2]===maxNeighbor) {
           tileEdges[7][i2] = minNeighbor;
           tileEdges[8][i2] = mapping[tileEdges[8][i2]][reMap];
         }
         if (tileEdges[9][i2]===maxNeighbor) {
           tileEdges[9][i2] = minNeighbor;
           tileEdges[10][i2] = mapping[tileEdges[10][i2]][reMap];
         }
       } // end for loop through all neighbor maps
     } // end j loop
   } // end i loop

   // this looks for symmetry of each edge.
   for ( i = 0;i<tileLength;i++) {
        var checkSym = [0,0,0,0];
        for ( j = 2;j<11;j=j+2) {
          checkSym[tileEdges[j][i]]=1;
        }
        var symCount = 0;
        var binarySum = 0;
        for ( j = 0; j<4;j++){
              if (checkSym[j] === 1) {
                  symCount++;
                  binarySum = binarySum + j;
              }
        }
        // if only one symmetry mapping - use it,
        // if more than three types -> straight line.
        // if two types: 0,1>1; 0,2>2; 0,3>3; 1,2>3; 1,3>2; 2,3>1
        if (symCount === 1) {tileEdges[0][i]=0;}
        if (symCount > 2) {tileEdges[0][i]=2;}
        if (symCount === 2) {
            if (binarySum <4) {tileEdges[0][i] = binarySum;}
            if (binarySum >3) {tileEdges[0][i] = 6 - binarySum;}
        }  // end symCount = 2         
    } // end find edge symmetry for each.
  
    // set symmetry of base edges
    for ( i = 0;i<tileLength;i++) {
      tileEdges[0][tileEdges[1][i]]=
      edgeSymmetry[tileEdges[0][i]] [tileEdges[0][tileEdges[1][i]]];
    } // end set symmetry of base edges.
 
    // choose best map for that symmetry
    for ( i = 0;i<tileLength;i++) {
      tileEdges[0][i]=tileEdges[0][tileEdges[1][i]];
      tileEdges[2][i]=symmetryToMap[tileEdges[0][i]][tileEdges[2][i]];
    } // end of choose correct map for that symmetry    

    // flag if immpossible
    var impossible = 0;
    // array of why impossible. 0 = duplicates one with fewer edges
    // 1 = no angles add to non zero. 2 = self intersection. 
    var imposs = [0,0,0];

    // Print angle info  
    if (allPrint === 1) {
     forTextFile += "TileAngle to start" + "\r\n";
     for ( i = 0;i<angleCounter; i++) {
       for ( j = 0; j<tileLength; j++) {
         forTextFile += ""+tileAngles[i][j]+" ";
       }
     forTextFile += "\r\n";
     }
    }
   
    // check if the tile is duplicated with fewer edges by checking if the angles all map to vertices
    var vertexAngle = Array(tileLength+1).fill(0);
    // set all to zero to start;
    for ( i = 0; i<tileLength; i++){
       vertexAngle[i] = 0;
    }
    // set all of the original vertices as vertices = 1
    for ( i = 0; i<netAngles.length;i++) {
     for ( j = 0; j<tileLength; j++) {
        if (tileAngles [i][j] != 0) vertexAngle [j] = 1;
     }
    }

    // Do we have any inside angles?
    if (netAngles.length < angleCounter) {
     // loop through them
     for ( i = netAngles.length; i<angleCounter; i++) {
       for ( j = 0; j<tileLength; j++) {
         // if this row has is a vertex
         if ((tileAngles [i][j] != 0) && (vertexAngle [j] === 1)) {
           // loop through row again looking for non vertices.
           for ( k = 0; k<tileLength; k++) {
             // if we find a new vertex  
             if ((tileAngles [i][k] != 0) && (vertexAngle [k] === 0)) {
               // restart the loops;
               i = netAngles.length;
               j = 0;
               // set this angle as a vertex
               vertexAngle [k] = 1;
             }
           }
         }
       }  
     }
    }
    
    for ( i = 0; i < tileLength; i++) {
      // if this reduces to a smaller tile
      if (vertexAngle[i] === 0) {
          impossible = 1;
          imposs [0] = 1;
      }
    }
    reducibleVertex = vertexAngle.slice();

    if (allPrint === 1) {
     // Print which are vertices.
     forTextFile += "vertex angles" + "\r\n";
     for ( i = 0; i < tileLength; i++) {
      forTextFile += ""+vertexAngle[i]+" ";
     }
    forTextFile += "\r\n";
    }

    // now work with the angles
      var row = 0;
      var angle = 0;
      var maxLength = tileAngles.length;
     
      // reduce the rows by common divisors
      for ( r = 0; r < tileAngles.length;r++) {    
        var GCD = 0;
        for ( a = 0; a<tileLength+1;a++) {
         var current = tileAngles[r][a];
         if (current!=0 && GCD != 1) {
            if (GCD === 0) GCD = Math.abs(current);
            for ( divisor = GCD; divisor > 0;divisor--) {
              if (GCD%divisor === 0 && current%divisor === 0) {
                 GCD = divisor;
                 divisor = 0;
              }
            }
         } // end current != 0 && GCD != 1  
        } // end find GCD for row r.
        if (GCD === 0) GCD = 1;
        var opposite = 0;
        if (tileAngles[r][tileLength]<0) opposite = -1;
        for ( a = 0; a<tileLength+1;a++) {
           if (opposite === 0 && tileAngles[r][a] !=0) 
             opposite = Math.abs(tileAngles[r][a])/tileAngles[r][a];
           tileAngles[r][a]=opposite*tileAngles[r][a]/GCD;
        }
      } // end reduce rows    
     
      // this does Gaussian elimination on angles.
      while (row < maxLength && angle < tileLength) {
          var maxValue = Math.abs(tileAngles[row][angle]);
          var maxRow = row;
          // find the largest value below the pivot row for this angle
          for ( r = row+1;r <maxLength;r++) {
              if (Math.abs(tileAngles[r][angle])>maxValue) {
                  maxValue = Math.abs(tileAngles[r][angle]);
                  maxRow = r;
              }
          }
          if (maxValue != 0) {
                            
              // switchRows (row, maxRow);
              for ( a = 0; a < tileLength+1;a++) {
                  var variable = tileAngles[row][a];
                  tileAngles[row][a]=tileAngles[maxRow][a];
                  tileAngles[maxRow][a]=variable;
              }
              // don't divide row by maxValue - keep integer.
              // change all lower rows to not have value for angle.
              var rowMult = tileAngles[row][angle];  
              for ( r = 0;r<maxLength;r++) {
                if (r != row) {  // don't try to eliminate yourself...
                  // multiply the rows and add.
                  var rMult = tileAngles[r][angle];
                  if (rMult != 0) { // avoid useless multiplication of rows
                    for ( a = 0; a < tileLength+1;a++) {
                      tileAngles[r][a]= -rowMult * tileAngles[r][a] 
                                       + rMult * tileAngles[row][a];
                    }
                    
                    // now reduce the row
                    var GCD = 0;
                    for ( a = 0; a<tileLength+1;a++) {
                      var current = tileAngles[r][a];
                      if (current!=0 && GCD != 1) {
                        if (GCD === 0) GCD = Math.abs(current);
                        for ( divisor = GCD; divisor > 0;divisor--) {
                         if (GCD%divisor === 0 && current%divisor === 0) {
                          GCD = divisor;
                          divisor = 0;
                         }
                        }
                      } // end current != 0 && GCD != 1  
                    } // end find GCD for row r.
                    if (GCD === 0) GCD = 1;
                    var opposite = 0;
                    if (tileAngles[r][tileLength]<0) opposite = -1;
                    for ( a = 0; a<tileLength+1;a++) {
                      if (opposite === 0 && tileAngles[r][a] !=0) 
                         opposite = Math.abs(tileAngles[r][a])/tileAngles[r][a];
                      tileAngles[r][a]=opposite*tileAngles[r][a]/GCD;
                    }
                  }
                }
              }
              row = row + 1;
          }
          angle = angle + 1;      
      } // end Gaussian elimination while loop
        
      // reduce the rows by common divisors again
      for ( r = 0; r < maxLength;r++) {
         var GCD = 0;
         for ( a = 0; a<tileLength+1;a++) {
           var current = tileAngles[r][a];
           if (current!=0 && GCD != 1) {
              if (GCD === 0) GCD = Math.abs(current);
              for ( divisor = GCD; divisor > 0;divisor--) {
// alert(divisor);
                  if (GCD%divisor === 0 && current%divisor === 0) {
                   GCD = divisor;
                   divisor = 0;
                }
              }
           } // end current != 0 && GCD != 1  
         } // end find GCD for row r.
         if (GCD === 0) GCD = 1;
         var opposite = 0;
         if (tileAngles[r][tileLength]<0) opposite = -1;
         for ( a = 0; a<tileLength+1;a++) {
            if (opposite === 0 && tileAngles[r][a] !=0) 
                opposite = Math.abs(tileAngles[r][a])/tileAngles[r][a];
            tileAngles[r][a]=opposite*tileAngles[r][a]/GCD;
         }       
      } // end reduce rows
                
      // sort tileAngles
      var lastRow = 0;
      for ( j = 0; j < tileAngles.length;j++) {
        var sumAngles = 0;
        for ( i = 0; i < tileLength+1; i++) {
          sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
        }
        if (sumAngles > 0) {
            // switchRows (j, lastRow);
              for ( a = 0; a < tileLength+1;a++) {
                  var variable = tileAngles[j][a];
                  tileAngles[j][a]=tileAngles[lastRow][a];
                  tileAngles[lastRow][a]=variable;
              }
              lastRow++;
        }
      }
    
   // sort all with one angle 
      var currentRow = 0;
      for ( j = 0; j < lastRow;j++) {
        var sumAngles = 0;
        for ( i = 0; i < tileLength; i++) {
          sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
        }
        // if no angles add to nonzero
        if (sumAngles === 0) {
          //  alert("*** impossible sum");
          impossible = 1;
          imposs [1] = 1;  
        }
        if (sumAngles === 1) {    
            // if one angle is zero mod 360° check edge
            if (tileAngles[j][tileLength] === 0) {
              var location = 0;
              for ( b = 0;b<tileLength;b++){
                if ((tileAngles[j][b]+720)%360 != 0){
                  location = b;  
                }
              }
              var whichEdge = tileEdges[1][location];
              var otherEdge = tileEdges[1][(location-1+tileLength)%tileLength];
              if (whichEdge === otherEdge) {         
                // alert("*** Self intersection");
                impossible = 1;
                imposs [2] = 1;  
              }
            }
            // switchRows (j, currentRow);
            for ( a = 0; a < tileLength+1;a++) {
                  var variable = tileAngles[j][a];
                  tileAngles[j][a]=tileAngles[currentRow][a];
                  tileAngles[currentRow][a]=variable;
              }
            currentRow++;
        }
      }
 
      if (allPrint === 1) {
        // Print tileAngles that aren't zeros
        forTextFile += "tileAngles" + "\r\n";
        for ( j = 0; j < lastRow;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
    //            alert("."+tileAngles[j][i]);
          }
          if (sumAngles > 0) {forTextFile += angleText + "\r\n";}
  //         alert(angleText + " # ");
        }
      }     
            
      // find all angles that equal each other, as 1 and -1 = 0
      for ( j = currentRow; j < lastRow;j++) {
        for ( k=j;k<lastRow;k++) {
          if (k>j) {
            var differences = 0;  
            var first = 0;
            var second = 0;
            var multiplier = 0;
            for ( eRow = 0;eRow < tileLength;eRow++) {
              var angle1 = tileAngles[j][eRow];
              var angle2 = tileAngles[k][eRow];
              if (angle1 != 0 || angle2 != 0) {
                if (angle1 != 0 && angle2 != 0) {
                  if (Math.abs(angle1) === Math.abs(angle2)) {
                    if (multiplier ===0) multiplier = angle1/angle2;
                    if (multiplier*angle2 != angle1) differences = 5;
                  } // end check multiplier
                  if (Math.abs(angle1) != Math.abs(angle2)) {
                    differences = 5;  
                  }
                } // end both nonzero
                if (angle1 === 0) {
                    second = angle2;
                    differences++;
                }
                if (angle2 === 0) {
                    first = angle1;
                    differences++;
                }
              } // end something non zero 
            } // end looking at all of eRow
            if (differences === 2 && multiplier != 0) {
              if (tileAngles[j][tileLength] === 
                  multiplier*tileAngles[k][tileLength]) { 
                if (first != 0 && second != 0) {
                  if(first === second*multiplier) {                      
                      
                      
                    // here we subtract the rows.
                    for ( a = 0; a<tileLength +1;a++) {
                      tileAngles[j][a] = tileAngles[j][a] - 
                                 multiplier*tileAngles[k][a];  
                    }      
              
                    // now reduce the row
                    var GCD = 0;
                    for ( a = 0; a<tileLength+1;a++) {
                      var current = tileAngles[j][a];
                      if (current!=0 && GCD != 1) {
                        if (GCD === 0) GCD = Math.abs(current);
                        for ( divisor = GCD; divisor > 0;divisor--) {
                         if (GCD%divisor === 0 && current%divisor === 0) {
                          GCD = divisor;
                          divisor = 0;
                         }
                        }
                      } // end current != 0 && GCD != 1  
                    } // end find GCD for row j.
                    
                    if (GCD === 0) GCD = 1;
                    var opposite = 0;
                    if (tileAngles[j][tileLength]<0) opposite = -1;
                    for ( a = 0; a<tileLength+1;a++) {
                      if (opposite === 0 && tileAngles[j][a] !=0) 
                          opposite = Math.abs(tileAngles[j][a])/tileAngles[j][a];
                      tileAngles[j][a]=opposite*tileAngles[j][a]/GCD;
                    }
                    
                    
                    
                    
                    row = j;
                    for ( a = 0; a<tileLength + 1;a++) {
                        if (tileAngles[row][a] != 0) angle = a;
                    } // end set angle to last non zero value
                                               
                    // change all other rows to not have value for angle.
                    var rowMult = tileAngles[row][angle];  
                    for ( r = 0;r<maxLength;r++) {
                      if (r != row) {  // don't try to eliminate yourself...
                        // multiply the rows and add.
                        var rMult = tileAngles[r][angle];
                        if (rMult != 0) { // avoid useless multiplication of rows
                          for ( a = 0; a < tileLength+1;a++) {
                            tileAngles[r][a]= -rowMult * tileAngles[r][a] 
                                             + rMult * tileAngles[row][a];
                          }
                    
                          // now reduce the row
                          GCD = 0;
                          for ( a = 0; a<tileLength+1;a++) {
                            var current = tileAngles[r][a];
                            if (current!=0 && GCD != 1) {
                              if (GCD === 0) GCD = Math.abs(current);
                              for ( divisor = GCD; divisor > 0;divisor--) {
                               if (GCD%divisor === 0 && current%divisor === 0) {
                                GCD = divisor;
                                divisor = 0;
                               }
                              }
                            } // end current != 0 && GCD != 1  
                          } // end find GCD for row r.
                          if (GCD === 0) GCD = 1;
                          opposite = 0;
                          if (tileAngles[r][tileLength]<0) opposite = -1;
                          for ( a = 0; a<tileLength+1;a++) {
                            if (opposite === 0 && tileAngles[r][a] !=0) 
                                opposite = Math.abs(tileAngles[r][a])/tileAngles[r][a];
                            tileAngles[r][a]=opposite*tileAngles[r][a]/GCD;
                          } // end all of reducing
                        } // end avoid useless multi
                      } // end don't eliminate self
                    } // end set other rows to zero at this place
                    
                  } // need matched angles  
                } 
              } // need sums matched
            } // need two different
            
          }
        } 
      } // end finding all equal angles.

     
      // reduce the rows by common divisors
      for ( r = 0; r < tileAngles.length;r++) {    
        var GCD = 0;
        for ( a = 0; a<tileLength+1;a++) {
         var current = tileAngles[r][a];
         if (current!=0 && GCD != 1) {
            if (GCD === 0) GCD = Math.abs(current);
            for ( divisor = GCD; divisor > 0;divisor--) {
              if (GCD%divisor === 0 && current%divisor === 0) {
                 GCD = divisor;
                 divisor = 0;
              }
            }
         } // end current != 0 && GCD != 1  
        } // end find GCD for row r.
        if (GCD === 0) GCD = 1;
        var opposite = 0;
        if (tileAngles[r][tileLength]<0) opposite = -1;
        for ( a = 0; a<tileLength+1;a++) {
           if (opposite === 0 && tileAngles[r][a] !=0) 
             opposite = Math.abs(tileAngles[r][a])/tileAngles[r][a];
           tileAngles[r][a]=opposite*tileAngles[r][a]/GCD;
        }
      } // end reduce rows    

/*
      
     forTextFile += "tileAngles" + "\r\n";
 //       for ( j = 0; j < lastRow;j++) {
     for ( j = 0; j < tileAngles.length;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
           //   alert("."+tileAngles[j][i]);
          }
    //      if (sumAngles > 0) {alert(angleText);}
          forTextFile += angleText + "\r\n";
        }
*/


               
      // sort the rows
      var anglesInRow  = Array(tileAngles.length).fill(0);    // how many angles are in this row
      // count angles in each row
      for ( r = 0; r < tileAngles.length;r++) {    
        var angleCount = 0;
        for ( a = 0; a<tileLength+1;a++) {
          if (tileAngles[r][a] != 0) angleCount++;  
        } // end find number of angles in row r. 
        anglesInRow[r] = angleCount;
      } // end counting angles in each row
  
      var currentAngleRow = 0;
      // sort impossible rows (zero sums to nonzero)
      for ( r = 0; r < tileAngles.length;r++) {    
         if ((anglesInRow[r] === 0) && (tileAngles[r][tileLength] != 0)) {
            // switch row r and row currentAngleRow  
            for ( a = 0; a<tileLength+1;a++) {
               var b = tileAngles[r][a];
               tileAngles[r][a]=tileAngles[currentAngleRow][a];
               tileAngles[currentAngleRow][a] = b;
               b = anglesInRow[r];
               anglesInRow[r] = anglesInRow[currentAngleRow];
               anglesInRow[currentAngleRow] = b;
            }
            currentAngleRow++;
         }
      } // end impossible row sort
        
      if (currentAngleRow < tileAngles.length) {
       // sort rows with one angle
       for ( r = currentAngleRow; r < tileAngles.length;r++) {    
         if ((anglesInRow[r] === 1)&&(currentAngleRow < tileAngles.length)) {
            // switch row r and row currentAngleRow  
            for ( a = 0; a<tileLength+1;a++) {
               var b = tileAngles[r][a];
               tileAngles[r][a]=tileAngles[currentAngleRow][a];
               tileAngles[currentAngleRow][a] = b;
               b = anglesInRow[r];
               anglesInRow[r] = anglesInRow[currentAngleRow];
               anglesInRow[currentAngleRow] = b;
            }
            currentAngleRow++;
         }
       } // end rows with one angle
      } // end if 




/*
    
     forTextFile += "tileAngles" + "\r\n";
 //       for ( j = 0; j < lastRow;j++) {
     for ( j = 0; j < tileAngles.length;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
           //   alert("."+tileAngles[j][i]);
          }
    //      if (sumAngles > 0) alert(angleText);
           forTextFile += angleText + "\r\n";
        }
*/


      

      if (currentAngleRow < tileAngles.length) {              
       // sort rows with two angles and zero sum
       for ( r = currentAngleRow; r < tileAngles.length;r++) {    
         if ((anglesInRow[r] === 2)&&(currentAngleRow < tileAngles.length)&&(tileAngles[r][tileLength] === 0)) {
            // switch row r and row currentAngleRow  
            for ( a = 0; a<tileLength+1;a++) {
               var b = tileAngles[r][a];
               tileAngles[r][a]=tileAngles[currentAngleRow][a];
               tileAngles[currentAngleRow][a] = b;
               b = anglesInRow[r];
               anglesInRow[r] = anglesInRow[currentAngleRow];
               anglesInRow[currentAngleRow] = b;
            }
            currentAngleRow++;
         }
       } // end rows with two angles and zero sum
      } // end if 
      


/*
              
     forTextFile += "tileAngles" + "\r\n";
 //       for ( j = 0; j < lastRow;j++) {
     for ( j = 0; j < tileAngles.length;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
           //   alert("."+tileAngles[j][i]);
          }
    //      if (sumAngles > 0) alert(angleText);
           forTextFile += angleText + "\r\n";
        }
*/


              
      if (currentAngleRow < tileAngles.length) {              
       // sort rows with two angles and non zero sum
       for ( r = currentAngleRow; r < tileAngles.length;r++) {    
         if ((anglesInRow[r] === 2)&&(currentAngleRow < tileAngles.length)&&(tileAngles[r][tileLength] != 0)) {
            // switch row r and row currentAngleRow  
            for ( a = 0; a<tileLength+1;a++) {
               var b = tileAngles[r][a];
               tileAngles[r][a]=tileAngles[currentAngleRow][a];
               tileAngles[currentAngleRow][a] = b;
               b = anglesInRow[r];
               anglesInRow[r] = anglesInRow[currentAngleRow];
               anglesInRow[currentAngleRow] = b;
            }
            currentAngleRow++;
         }
       } // end rows with two angles and non zero sum
      } // end if 
             
      


/*
     forTextFile += "tileAngles" + "\r\n";
 //       for ( j = 0; j < lastRow;j++) {
     for ( j = 0; j < tileAngles.length;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
           //   alert("."+tileAngles[j][i]);
          }
    //      if (sumAngles > 0) alert(angleText);
           forTextFile += angleText + "\r\n";
        }
  


*/               
              
      if (currentAngleRow < tileAngles.length) {              
       // sort non zero rows
       for ( r = currentAngleRow; r < tileAngles.length;r++) {    
         if ((anglesInRow[r] >2)&&(currentAngleRow < tileAngles.length)) {
            // switch row r and row currentAngleRow  
            for ( a = 0; a<tileLength+1;a++) {
               var b = tileAngles[r][a];
               tileAngles[r][a]=tileAngles[currentAngleRow][a];
               tileAngles[currentAngleRow][a] = b;
               b = anglesInRow[r];
               anglesInRow[r] = anglesInRow[currentAngleRow];
               anglesInRow[currentAngleRow] = b;
            }
            currentAngleRow++;
         }
       } // end non zero rows
      } // end if 
      
      // Always emit the tile data (size / edge sym / which edge / mapping / tileAngles).
      // Callers decide whether a config is drawable from the "impossible - ..." reason
      // appended below, so "reducible"/"isohedral" configs can still be drawn.
      tileAnglesOut = tileAngles;
      if (true) {
        forTextFile += "size:" + "\r\n";
        for ( j = 0;j<firstPolygonSize;j++) {
          forTextFile += "."+netEdgeData[4][j];
        }
        forTextFile += "\r\n";
        for ( j = firstPolygonSize;j<netEdgesSum;j++) {
          forTextFile +=  "."+netEdgeData[4][j];
        }
        forTextFile += "\r\n";

         
        // Print edge sym., which edge congruent to, mapping.
        forTextFile += "Edge Sym " + "\r\n";
        for ( k = 0; k < tileLength; k++) {
            forTextFile += " "+tileEdges[0][k];
        }
        forTextFile += "\r\n";
        forTextFile += "Which Edge " + "\r\n";
        for ( k = 0; k < tileLength; k++) {
            forTextFile += tileEdges[1][k]+" ";
        }
        forTextFile += "\r\n";
        forTextFile += "Mapping " + "\r\n";
        for ( k = 0; k < tileLength; k++) {
            forTextFile += tileEdges[2][k]+" ";
        }
        forTextFile += "\r\n";
          
        // Print tileAngles that aren't zeros
        forTextFile += "tileAngles" + "\r\n";
        for ( j = 0; j < tileAngles.length;j++) {
          var angleText = "";
          var sumAngles = 0;
          for ( i = 0; i < tileLength+1; i++) {
            sumAngles = sumAngles + Math.abs(tileAngles[j][i]);
            angleText = angleText+"."+tileAngles[j][i];
           //   System.out.print("."+tileAngles[j][i]);
          }
          if (sumAngles > 0) {forTextFile += angleText + "\r\n";}     
        }
      } // end printing if impossible === 0 or allPrint === 1
      
      if (impossible != 0) {
      //    System.out.println("impossible");
          if (imposs[0] === 1 ) 
            {forTextFile +="impossible - reducible" + "\r\n"}
          if (imposs[1] === 1 ) 
            {forTextFile +="impossible - no angles add to non zero"+ "\r\n"}
          if (imposs[2] === 1 ) 
            {forTextFile +="impossible - self intersection"+ "\r\n"}
      } // if impossible
   forTextFile += "\r\n";
  } // end adjacentSetup ()


function txtToFile(content, filename, contentType) {
  const a = document.createElement('a');
  const file = new Blob([content], {type: "text/plain", endings: "native"});
  
  a.href= URL.createObjectURL(file);
  a.download = filename;
  a.click();

  URL.revokeObjectURL(a.href);
};


