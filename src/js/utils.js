export function escapeRegExp(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\\\$&');
}

export function buildAuthHeader(){
	db = storage.get('database-info', function(error, data){
		return "Basic " + btoa(db.user + ":" + db.password)	
	})
}

//Graph Utils
export function setNodeData(sigmaInstance, startLabel, endLabel){
	appStore.startNode = null;
	appStore.endNode = null;

	startLabel = (typeof startLabel === 'undefined') ? undefined : startLabel
	endLabel = (typeof endLabel === 'undefined') ? undefined : endLabel

	$.each(sigmaInstance.graph.nodes(), function(index, node){
		node.degree = sigmaInstance.graph.degree(node.id);
		node.glyphs = []
		node.folded = {
			nodes: [],
			edges: []
		}
	});

	$.each(sigmaInstance.graph.nodes(), function(index, node){
		var s = node.neo4j_labels[0]
		switch (s) {
			case "Group":
				node.type_group = true;
				break;
			case "User":
				node.type_user = true;
				break;
			case "Computer":
				node.type_computer = true;
				break;
			case "Domain":
				node.type_domain = true;
				break;
			default:
				console.log('Something has gone terribly wrong');
		}

		if (node.neo4j_data.name === startLabel){
			appStore.startNode = node;
		}

		if (node.neo4j_data.name === endLabel){
			appStore.endNode = node;
		}
	});

	if (appStore.startNode !== null){
		appStore.startNode.glyphs.push({
			'position': 'bottom-right',
            'font': 'FontAwesome',
            'content': '\uF21D',
            'fillColor': '#3399FF',
            'fontScale': 1.5
		})
	}

	if (appStore.endNode !== null){
		appStore.endNode.glyphs.push({
			'position': 'bottom-right',
            'font': 'FontAwesome',
            'fillColor': '#990000',
            'content': '\uF05B',
            'fontScale': 1.5
		})
	}
	return sigmaInstance
}

export function collapseEdgeNodes(sigmaInstance){
	var threshold = appStore.performance.edge;

	if (threshold == 0){
		return;
	}
	$.each(sigmaInstance.graph.nodes(), function(index, node){
		if (node.degree < threshold){
			return;
		}

		$.each(sigmaInstance.graph.adjacentNodes(node.id), function(index, anode){
			if (anode.neo4j_data.name === appStore.endNode || anode.neo4j_data.name === appStore.startNode){
				return;
			}

			var edges = sigmaInstance.graph.adjacentEdges(anode.id);
			if ((edges.length > 1 || edges.length === 0) || (anode.folded.nodes.length > 0)){
				return;
			}

			var edge = edges[0];

			if ((anode.type_user && (edge.label === 'MemberOf' || edge.label === 'AdminTo')) 
				|| (anode.type_computer && (edge.label === 'AdminTo' || edge.label === 'MemberOf')) 
				|| (anode.type_group && edge.label === 'AdminTo')){

				node.isGrouped = true
				node.folded.nodes.push(anode)
				node.folded.edges.push(edge)
				appStore.spotlightData[anode.id] = [anode.neo4j_data.name, node.id, node.neo4j_data.name];
				sigmaInstance.graph.dropNode(anode.id);
			}
		});
		if (node.folded.nodes.length > 0){
			node.glyphs.push({
				'position': 'bottom-left',
				'content': node.folded.nodes.length
			})	
		}
	})

	return sigmaInstance
}

export function collapseSiblingNodes(sigmaInstance){
	var threshold = appStore.performance.sibling

	if (threshold === 0){
		return;
	}

	$.each(sigmaInstance.graph.nodes(), function(index, node){
		//Dont apply this logic to anything thats folded or isn't a computer
		if (!node.type_computer || node.folded.nodes.length > 0){
			return
		}

		//Start by getting all the edges attached to this node
		var adjacent = sigmaInstance.graph.adjacentEdges(node.id)
		var siblings = []

		//Check to see if all the edges are the same type (i.e. AdminTo)
		if (adjacent.length > 1 && adjacent.allEdgesSameType()){
			//Get the "parents" by mapping the source from every edge
			var parents = adjacent.map(
				function(e){
					return e.source
				}
			)

			//Generate our string to compare other nodes to 
			//by sorting the parents and turning it into a string
			var checkString = parents.sort().join(',')
			var testString; 

			//Loop back over nodes in the graph and look for any nodes
			//with identical parents
			$.each(sigmaInstance.graph.nodes(), function(index, node2){
				testString = sigmaInstance.graph.adjacentEdges(node2.id).map(
					function(e){
						return e.source;
					}
				).sort().join(',')
				if (testString === checkString){
					siblings.push(node2);
				}
			});

			if (siblings.length >= threshold){
				//Generate a new ID for our grouped node
				var nodeId = generateUniqueId(sigmaInstance, true);

				sigmaInstance.graph.addNode({
					id: nodeId,
					x: node.x,
					y: node.y,
					degree: siblings.length,
					label: "Grouped Computers",
					neo4j_labels: ['Computer'],
					neo4j_data: { name: "Grouped Computers" },
					groupedNode: true,
					glyphs: [{
						position: 'bottom-left',
						content: siblings.length
					}],
					folded: {
						nodes: [],
						edges: []
					}
				});

				//Generate new edges for each parent going to our new node
				$.each(parents, function(index, parent){
					var id = generateUniqueId(sigmaInstance, false);

					sigmaInstance.graph.addEdge({
						id: id,
						source: parent,
						target: nodeId,
						label: 'AdminTo',
						neo4j_type: 'AdminTo',
						size: 1
					})
				})

				var n = sigmaInstance.graph.nodes(nodeId);
				//Loop over all the siblings, and push the edges into our new parent node
				//Push the nodes in as well so we can unfold them
				$.each(siblings, function(index, sibling){
					$.each(sigmaInstance.graph.adjacentEdges(sibling.id), function(index, edge){
						n.folded.edges.push(edge)
					})

					n.folded.nodes.push(sibling)
					appStore.spotlightData[sibling.id] = [sibling.neo4j_data.name, nodeId, n.label];
					sigmaInstance.graph.dropNode(sibling.id)
				})
			}
		}
	})
	return sigmaInstance
}

export function generateUniqueId(sigmaInstance, isNode){
	var i = Math.floor(Math.random() * (100000 - 10 + 1)) + 10;
	if (isNode){
		while (typeof sigmaInstance.graph.nodes(i) !== 'undefined'){
			i = Math.floor(Math.random() * (100000 - 10 + 1)) + 10;
		}
	}else{
		while (typeof sigmaInstance.graph.edges(i) !== 'undefined'){
			i = Math.floor(Math.random() * (100000 - 10 + 1)) + 10;
		}
	}

	return i
}

//Recursive function to highlight paths to start/end nodes
export function findGraphPath(sigmaInstance, reverse, nodeid){
	var target = reverse ? appStore.startNode : appStore.endNode
	//This is our stop condition for recursing
	if (nodeid !== target.id){
		var edges = sigmaInstance.graph.adjacentEdges(nodeid)
		var nodes = reverse ? sigmaInstance.graph.inboundNodes(nodeid) : sigmaInstance.graph.outboundNodes(nodeid)
		//Loop over the nodes near us and the edges connecting to those nodes
		$.each(nodes, function(index, node){
			$.each(edges, function(index, edge){
				var check = reverse ? edge.source : edge.target
				//If an edge is pointing in the right direction, set its color
				//Push the edge into our store and then 
				if (check === node){
					edge.color = reverse ? 'blue' : 'red';
					appStore.highlightedEdges.push(edge);
					findGraphPath(sigmaInstance, reverse, node);
				}
			})
		})
	}else{
		sigmaInstance.refresh({'skipIndexation': true})
	}
}


//Utilities for generating AJAX requests
export function defaultAjaxSettings(){
	return {
		url: appStore.databaseInfo.url + '/db/data/transaction/commit',
		type: 'POST',
		accepts: { json: 'application/json' },
		dataType: 'json',
		contentType: 'application/json',
		headers: {
			'Authorization': btoa(appStore.databaseInfo.user + ':' + appStore.databaseInfo.password)
		}
	}
}

export function fullAjax(statements, callback){
	var options = defaultAjaxSettings();
	options.success = callback;
	if ($.isArray(statements)){
		var x = []
		$.each(statements, function(index, statement){
			x.push({"statement": statemnt})
		})
		options.data = JSON.stringify({
			"statements": x
		})
	}else{
		options.data = JSON.stringify({
			"statements": [{
				"statement" : statements
			}]
		})
	}

	return options
}